import { getConversationAesKey } from "./crypto/sessionKeyGenerator.js";
import { fetchPeerKeys } from "./api.js";

const aesKeyByConv = new Map();

export async function ensureConversationKeyFor(state, conversationId, peerId) {
    if (aesKeyByConv.has(conversationId))
        return aesKeyByConv.get(conversationId);

    const peerKeys = await fetchPeerKeys(state, peerId);
    const key = await getConversationAesKey({
        myDhPrivateKey: state.identity.priv.dhPrivateKey,
        theirDhPubJwk: peerKeys.dhPubJwk,
        conversationId,
        myUserId: state.myId,
        theirUserId: peerId
    });

    aesKeyByConv.set(conversationId, key);
    return key;
}