// Party invite links — the app side.
//
// Outgoing: sharePartyLink() asks the API for the party's https link and hands
// it to the share sheet. iMessage fetches that URL and renders the photo card
// from its Open Graph tags (backend/src/invitePage.js). Before this, "send it"
// shared plain text and the recipient had nothing to tap.
//
// Incoming: the same link, tapped on a phone with Scene installed, arrives via
// universal links (https://<share host>/e/<token>, see ios.associatedDomains
// and android.intentFilters in app.config.js) or via the custom scheme the web page's "open in scene"
// button uses (scene://e/<token>). parseInviteToken() accepts both.
import { Platform, Share, Alert } from 'react-native';
import Constants from 'expo-constants';
import { events as eventsApi } from './api';

// Hosts this binary claims (app.config.js → extra.linkHosts). The API builds
// links from SHARE_BASE_URL; if that names a host the app wasn't built for,
// the link still works as a web page but never opens the app, which is easy
// to miss. Say so loudly instead.
const LINK_HOSTS = Constants.expoConfig?.extra?.linkHosts ?? [];

export function checkLinkHost(url) {
  // A regex, not new URL(): React Native's URL polyfill has no `hostname`.
  const m = typeof url === 'string' && url.match(/^https?:\/\/([^/:?#]+)/i);
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (!LINK_HOSTS.length || LINK_HOSTS.includes(host)) return true;
  console.warn(
    `[invite links] the API returned a link on ${host}, but this build only opens ` +
      `${LINK_HOSTS.join(', ')}. Set SHARE_BASE_URL and EXPO_PUBLIC_SHARE_HOST to the same host ` +
      'and rebuild (see backend/README.md, "Invite links: domain day").',
  );
  return false;
}

// https://host/e/TOKEN, scene://e/TOKEN — with or without a trailing slash,
// query or fragment. Token alphabet matches the backend's (base64url).
const INVITE_RE = /^(?:https?:\/\/[^/]+\/|scene:\/\/)e\/([A-Za-z0-9_-]{16,64})(?:[/?#]|$)/;

export function parseInviteToken(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(INVITE_RE);
  return m ? m[1] : null;
}

// Only the host can hand out a private party's link; the server enforces the
// same rule (403), this just keeps the button off screens where it can't work.
export function canShareParty(event, currentUserId) {
  return !!event && (!event.is_private || event.host_id === currentUserId);
}

function flyerLine(event) {
  const when = event.start_time
    ? new Date(event.start_time).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : '';
  return `${event.title}${when ? ` — ${when}` : ''}`;
}

export async function sharePartyLink(event) {
  let url;
  try {
    ({ url } = await eventsApi.inviteLink(event.id));
  } catch (err) {
    const msg = err?.status === 409
      ? 'this party got called off.'
      : err?.status === 403
        ? 'only the host can send invites to a private party.'
        : "couldn't make a link — check your connection and try again.";
    Alert.alert("can't send this one", msg);
    return;
  }

  checkLinkHost(url);

  // iOS: pass the link as `url` so Messages builds the rich preview from it;
  // text in `message` rides along above the card. Android's share intent has
  // only one text field, so the link goes at the end of it.
  const line = flyerLine(event);
  const content = Platform.OS === 'ios'
    ? { message: line, url }
    : { message: `${line}\n${url}` };
  Share.share(content).catch(() => {});
}
