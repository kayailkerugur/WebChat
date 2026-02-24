import { getConversationAesKey } from "./crypto/sessionKeyGenerator.js";
import { fetchPeerKeys, fetchMyWrappedKey, changePinOnServer } from "./api.js";
import { initE2EEIdentity, getEncryptedIdentityRecord, setEncryptedIdentityRecord, rewrapIdentity } from "./crypto/initE2EEIdentity.js";
import { rotateE2EEPin } from "./crypto/rotateE2EEPin.js";
import { createState } from "./state.js";

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

export async function ensureIdentityWithRestore({ state, deviceId, pin }) {
  const localRecord = await getEncryptedIdentityRecord();
  if (!localRecord) {
    const serverKey = await fetchMyWrappedKey({ state, deviceId });
    if (serverKey?.kdf && serverKey?.wrappedPriv) {
      const record = {
        v: 1,
        deviceId,
        kdf: serverKey.kdf,
        enc: serverKey.wrappedPriv,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setEncryptedIdentityRecord(record);
    }
  }
  return initE2EEIdentity({ password: pin, deviceId });
}

export async function onNewPin(oldPin, newPin) {
  const state = createState();

  await rotateE2EEPin({
    state,
    deviceId: state.myDeviceId,
    oldPin,
    newPin,
    getEncryptedIdentityRecord,
    setEncryptedIdentityRecord,
  });
}