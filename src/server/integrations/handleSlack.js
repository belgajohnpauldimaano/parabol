import {verify} from 'jsonwebtoken';
import fetch from 'node-fetch';
import {stringify} from 'querystring';
import getRethink from 'server/database/rethinkDriver';
import getPubSub from 'server/utils/getPubSub';
import {clientSecret as auth0ClientSecret} from 'server/utils/auth0Helpers';
import closeClientPage from 'server/utils/closeClientPage';
import postOptions from 'server/utils/fetchOptions';
import makeAppLink from 'server/utils/makeAppLink';
import shortid from 'shortid';
import {SLACK} from 'universal/utils/constants';

export default async (req, res) => {
  closeClientPage(res);
  const {query: {code, state}} = req;
  if (!code) return;
  const [teamId, jwt] = state.split('::');
  if (!teamId || !jwt) return;
  const authToken = verify(jwt, Buffer.from(auth0ClientSecret, 'base64'));
  if (!authToken || !Array.isArray(authToken.tms) || !authToken.tms.includes(teamId)) return;
  const queryParams = {
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: makeAppLink('auth/slack')
  };
  const uri = `https://slack.com/api/oauth.access?${stringify(queryParams)}`;
  const slackRes = await fetch(uri, postOptions);
  const json = await slackRes.json();
  const {access_token: accessToken} = json;

  const now = new Date();
  const r = getRethink();
  await r.table('Provider')
    .getAll(teamId, {index: 'teamIds'})
    .filter({service: SLACK})
    .nth(0)('id')
    .default(null)
    .do((providerId) => {
      return r.branch(
        providerId.eq(null),
        r.table('Provider')
          .insert({
            id: shortid.generate(),
            accessToken,
            createdAt: now,
            service: SLACK,
            teamIds: [teamId],
            updatedAt: now
          }),
        r.table('Provider')
          .get(providerId)
          .update({
            accessToken,
            updatedAt: now
          })
      );
    });

  const providerUpdated = {
    providerRow: {
      accessToken,
      service: SLACK
    }
  };
  getPubSub().publish(`providerUpdated.${teamId}`, {providerUpdated});
  // const [userId, teamId] = teamMemberId;
  // const cachedFields = {
  //  providerUserName: user.name,
  //  providerUserId: user.id
  // };
  // handleIntegration(accessToken, exchange, SLACK, teamMemberId);

  // add this guy to all the other existing integrations as long as he didn't blacklist himself & has permission
  // const integrations = r.table('SlackIntegration')
  //  .getAll(teamId, {index: 'teamId'})
  //  .filter({isActive: true});
  //
  // const channelListUri = `https://slack.com/api/channels.list?token=${accessToken}&exclude_archive=1&exclude_members=1`;
  // const channelListRes = await fetch(channelListUri);
  // const channelListJson = channelListRes.json();
  // const {ok: listOK, channels} = channelListJson;
  // if (!listOK) {
  //  console.log('bad list', channelListJson);
  //  return;
  // }
  //
  // integrations.forEach((integration) => {
  //  if (integration.blackList.includes(userId)) return;
  //  const channelInfo = channels.find((channel) => channel.id === integration.channelId);
  //  if (channelInfo && channelInfo.is_member) {
  //    r.table('SlackIntegration').get(integration.id)
  //      .update((doc) => ({
  //        userIds: doc('userIds').append(userId).distinct()
  //      }))
  //      .run();
  //  }
  // });
};
