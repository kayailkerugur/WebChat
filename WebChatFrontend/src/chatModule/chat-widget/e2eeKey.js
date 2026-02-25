import { getConversationAesKey } from "./crypto/sessionKeyGenerator.js";
import { fetchPeerKeys, fetchMyWrappedKey, changePinOnServer } from "./api.js";
import { initE2EEIdentity, getEncryptedIdentityRecord, setEncryptedIdentityRecord, rewrapIdentity } from "./crypto/initE2EEIdentity.js";
import { rotateE2EEPin } from "./crypto/rotateE2EEPin.js";
import { createState } from "./state.js";
import { savePinToStorage } from "./index.js";

export const aesKeyByConv = new Map();

export async function ensureConversationKeyFor(state, conversationId, peerId) {
  if (aesKeyByConv.has(conversationId)) return aesKeyByConv.get(conversationId);

  const peerKeys = await fetchPeerKeys(state, peerId);

  if (!peerKeys) {
    throw new Error("PEER_E2EE_NOT_READY");
  }

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

export async function ensureIdentityWithRestore({ state, deviceId, pin }) {
  const local = await getEncryptedIdentityRecord();
  const serverKey = await fetchMyWrappedKey({ state, deviceId });

  const serverEnc = serverKey?.wrappedPriv ?? serverKey?.wrapped_priv;

  const serverNewer =
    serverKey?.updatedAt && local?.updatedAt &&
    new Date(serverKey.updatedAt) > new Date(local.updatedAt);

  if ((!local || serverNewer) && serverKey?.kdf && serverEnc) {
    await setEncryptedIdentityRecord({
      v: 1,
      deviceId,
      kdf: serverKey.kdf,
      enc: serverEnc,
      createdAt: local?.createdAt || new Date().toISOString(),
      updatedAt: serverKey.updatedAt || new Date().toISOString(),
    });
  }

  const ident = await initE2EEIdentity({ password: pin, deviceId });

  aesKeyByConv.clear();

  return ident;
}

export async function onNewPin(oldPin, newPin) {
  const state = createState();

  const result = await rotateE2EEPin({
    state,
    deviceId: state.myDeviceId,
    oldPin,
    newPin,
    getEncryptedIdentityRecord,
    setEncryptedIdentityRecord,
  });

  if (result.ok && !result.skipped) { 
     savePinToStorage(state, newPin);
  }
}