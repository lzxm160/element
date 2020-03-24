/* eslint-disable max-len */
const {
  getTestSideTree,
  changeKid,
  getDidDocumentForPayload,
  getCreatePayloadForKeyIndex,
  getLastOperation,
} = require('../../__tests__/test-utils');
const {
  getDidDocumentModel,
  makeSignedOperation,
  getCreatePayload,
  getUpdatePayloadForAddingAKey,
  getUpdatePayloadForRemovingAKey,
  getRecoverPayload,
  getDeletePayload,
} = require('../op');
const { getDidUniqueSuffix, decodeJson } = require('../../func');
const { MnemonicKeySystem } = require('../../../index');

const sidetree = getTestSideTree();

jest.setTimeout(10 * 1000);

describe('resolve', () => {
  describe('create', () => {
    const mks = new MnemonicKeySystem(MnemonicKeySystem.generateMnemonic());
    let createPayload;
    let didUniqueSuffix;
    let primaryKey;
    let recoveryKey;
    let didDocumentModel;

    beforeAll(() => {
      primaryKey = mks.getKeyForPurpose('primary', 0);
      recoveryKey = mks.getKeyForPurpose('recovery', 0);
      didDocumentModel = getDidDocumentModel(
        primaryKey.publicKey,
        recoveryKey.publicKey
      );
      createPayload = getCreatePayload(didDocumentModel, primaryKey);
      didUniqueSuffix = getDidUniqueSuffix(createPayload);
    });

    it('should not work if specified kid does not exist in did document', async () => {
      const invalidCreatePayload = changeKid(createPayload, '#invalidKid');
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidCreatePayload,
        didUniqueSuffix
      );
      expect(didDocument).not.toBeDefined();
    });

    it('should not work if signature is not valid', async () => {
      const invalidCreatePayload = getCreatePayload(
        didDocumentModel,
        recoveryKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidCreatePayload,
        didUniqueSuffix
      );
      expect(didDocument).not.toBeDefined();
    });

    it('should not work if payload is not a valid did document model', async () => {
      const invalidDidDocumentModel = {
        ...didDocumentModel,
        '@context': undefined,
      };
      const header = decodeJson(createPayload.protected);
      const invalidCreatePayload = makeSignedOperation(
        header,
        invalidDidDocumentModel,
        primaryKey.privateKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidCreatePayload,
        didUniqueSuffix
      );
      expect(didDocument).not.toBeDefined();
    });

    it('should not be resolveable before sync', async () => {
      // Here we set the just in time flag to false so that no syncing will occur
      await sidetree.batchScheduler.writeNow(createPayload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, false);
      expect(didDocument).not.toBeDefined();
    });

    it('should be resolveable after sync', async () => {
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      const did = `did:elem:${didUniqueSuffix}`;
      expect(didDocument.id).toBe(did);
      const decodedPayload = decodeJson(createPayload.payload);
      expect(didDocument['@context']).toBe(decodedPayload['@context']);
      expect(didDocument.publicKey[0]).toEqual({
        ...decodedPayload.publicKey[0],
        id: didDocument.id + decodedPayload.publicKey[0].id,
        controller: didDocument.id,
      });
      expect(didDocument.publicKey[1]).toEqual({
        ...decodedPayload.publicKey[1],
        id: didDocument.id + decodedPayload.publicKey[1].id,
        controller: didDocument.id,
      });
    });

    it('should populate the cache', async () => {
      const operations = await sidetree.db.readCollection(didUniqueSuffix);
      expect(operations.length >= 1).toBeTruthy();
      expect(operations[0].id).toBeDefined();
      expect(operations[0].type).toBeDefined();
      expect(operations[0].didUniqueSuffix).toBeDefined();
      expect(operations[0].transaction).toBeDefined();
      expect(operations[0].operation).toBeDefined();
    });

    it('should be resolveable again', async () => {
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      const did = `did:elem:${didUniqueSuffix}`;
      expect(didDocument.id).toBe(did);
    });
  });

  describe('update', () => {
    const mks = new MnemonicKeySystem(MnemonicKeySystem.generateMnemonic());
    let primaryKey;
    let recoveryKey;
    let didUniqueSuffix;
    let lastOperation;
    let createPayload;

    beforeAll(async () => {
      primaryKey = mks.getKeyForPurpose('primary', 0);
      recoveryKey = mks.getKeyForPurpose('recovery', 0);
      const didDocumentModel = getDidDocumentModel(
        primaryKey.publicKey,
        recoveryKey.publicKey
      );
      createPayload = getCreatePayload(didDocumentModel, primaryKey);
      didUniqueSuffix = getDidUniqueSuffix(createPayload);
      await sidetree.batchScheduler.writeNow(createPayload);
      lastOperation = await getLastOperation(sidetree, didUniqueSuffix);
    });

    it('should not work if specified kid does not exist in did document', async () => {
      const newKey = mks.getKeyForPurpose('primary', 1);
      const newPublicKey = {
        id: '#newKey',
        usage: 'signing',
        type: 'Secp256k1VerificationKey2018',
        publicKeyHex: newKey.publicKey,
      };
      const updatePayload = getUpdatePayloadForAddingAKey(
        lastOperation,
        newPublicKey,
        primaryKey.privateKey
      );
      const invalidUpdatePayload = changeKid(updatePayload);
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidUpdatePayload,
        didUniqueSuffix
      );
      expect(didDocument.publicKey).toHaveLength(2);
    });

    it('should not work if signature is not valid', async () => {
      const newKey = mks.getKeyForPurpose('primary', 1);
      const newPublicKey = {
        id: '#newKey',
        usage: 'signing',
        type: 'Secp256k1VerificationKey2018',
        publicKeyHex: newKey.publicKey,
      };
      const invalidUpdatePayload = getUpdatePayloadForAddingAKey(
        lastOperation,
        newPublicKey,
        recoveryKey.privateKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidUpdatePayload,
        didUniqueSuffix
      );
      expect(didDocument.publicKey).toHaveLength(2);
    });

    it('should add a new key', async () => {
      const newKey = mks.getKeyForPurpose('primary', 1);
      const newPublicKey = {
        id: '#newKey',
        usage: 'signing',
        type: 'Secp256k1VerificationKey2018',
        publicKeyHex: newKey.publicKey,
      };
      const payload = getUpdatePayloadForAddingAKey(
        lastOperation,
        newPublicKey,
        primaryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(payload);
      lastOperation = await getLastOperation(sidetree, didUniqueSuffix);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(3);
      expect(didDocument.publicKey[2].publicKeyHex).toBe(newKey.publicKey);
      expect(didDocument.publicKey[2].controller).toBe(didDocument.id);
    });

    it('should remove a key', async () => {
      const payload = getUpdatePayloadForRemovingAKey(
        lastOperation,
        '#newKey',
        primaryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(payload);
      lastOperation = await getLastOperation(sidetree, didUniqueSuffix);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(2);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(primaryKey.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should support multiple patches', async () => {
      const newKey2 = mks.getKeyForPurpose('primary', 2);
      const newKey3 = mks.getKeyForPurpose('primary', 3);
      const payload = {
        didUniqueSuffix: lastOperation.didUniqueSuffix,
        previousOperationHash: lastOperation.operation.operationHash,
        patches: [
          {
            action: 'add-public-keys',
            publicKeys: [
              {
                id: '#newKey2',
                usage: 'signing',
                type: 'Secp256k1VerificationKey2018',
                publicKeyHex: newKey2.publicKey,
              },
              {
                id: '#newKey3',
                usage: 'signing',
                type: 'Secp256k1VerificationKey2018',
                publicKeyHex: newKey3.publicKey,
              },
            ],
          },
          {
            action: 'remove-public-keys',
            publicKeys: ['#primary'],
          },
        ],
      };
      const header = {
        operation: 'update',
        kid: '#primary',
        alg: 'ES256K',
      };
      const operation = makeSignedOperation(
        header,
        payload,
        primaryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(operation);
      lastOperation = await getLastOperation(sidetree, didUniqueSuffix);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(3);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(recoveryKey.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(newKey2.publicKey);
      expect(didDocument.publicKey[2].publicKeyHex).toBe(newKey3.publicKey);
    });

    it('should not process a patch removing the recovery key', async () => {
      const payload = getUpdatePayloadForRemovingAKey(
        lastOperation,
        '#recovery',
        primaryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(payload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(3);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should do nothing if removing a key that does not exist', async () => {
      const payload = getUpdatePayloadForRemovingAKey(
        lastOperation,
        '#fakekid',
        primaryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(payload);
      lastOperation = await getLastOperation(sidetree, didUniqueSuffix);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(3);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should not process another create operation after update', async () => {
      await sidetree.batchScheduler.writeNow(createPayload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey).toHaveLength(3);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(recoveryKey.publicKey);
    });
  });

  describe('recover', () => {
    const mks = new MnemonicKeySystem(MnemonicKeySystem.generateMnemonic());
    let primaryKey;
    let recoveryKey;
    let primaryKey2;
    let recoveryKey2;
    let didUniqueSuffix;
    let didDocumentModel2;

    beforeAll(async () => {
      primaryKey = mks.getKeyForPurpose('primary', 0);
      recoveryKey = mks.getKeyForPurpose('recovery', 0);
      const didDocumentModel = getDidDocumentModel(
        primaryKey.publicKey,
        recoveryKey.publicKey
      );
      const createPayload = getCreatePayload(didDocumentModel, primaryKey);
      await sidetree.batchScheduler.writeNow(createPayload);
      didUniqueSuffix = getDidUniqueSuffix(createPayload);
      primaryKey2 = mks.getKeyForPurpose('primary', 1);
      recoveryKey2 = mks.getKeyForPurpose('recovery', 1);
      didDocumentModel2 = getDidDocumentModel(
        primaryKey2.publicKey,
        recoveryKey2.publicKey
      );
    });

    it('should not work if specified kid does not exist in did document', async () => {
      const recoverPayload = getRecoverPayload(
        didUniqueSuffix,
        didDocumentModel2,
        recoveryKey.privateKey
      );
      const invalidRecoverPayload = changeKid(recoverPayload, '#invalidKid');
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidRecoverPayload,
        didUniqueSuffix
      );
      expect(didDocument.publicKey[0].publicKeyHex).toBe(primaryKey.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should not work if signature is not valid', async () => {
      const invalidRecoverPayload = getRecoverPayload(
        didUniqueSuffix,
        didDocumentModel2,
        primaryKey.privateKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidRecoverPayload,
        didUniqueSuffix
      );
      expect(didDocument.publicKey[0].publicKeyHex).toBe(primaryKey.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should not work if payload is not a valid did document model', async () => {
      const invalidDidDocumentModel = {
        ...didDocumentModel2,
        '@context': undefined,
      };
      const payload = {
        didUniqueSuffix,
        newDidDocument: invalidDidDocumentModel,
      };
      const header = {
        operation: 'recover',
        kid: '#recovery',
        alg: 'ES256K',
      };
      const invalidRecoverPayload = makeSignedOperation(
        header,
        payload,
        recoveryKey.privateKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidRecoverPayload,
        didUniqueSuffix
      );
      expect(didDocument.publicKey[0].publicKeyHex).toBe(primaryKey.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(recoveryKey.publicKey);
    });

    it('should not work if there is no corresponding create operation', async () => {
      const fakeDidUniqueSuffix = 'fakediduniquesuffix';
      const invalidPayload = getRecoverPayload(
        fakeDidUniqueSuffix,
        didDocumentModel2,
        recoveryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(invalidPayload);
      const didDocument = await sidetree.resolve(fakeDidUniqueSuffix, true);
      expect(didDocument).not.toBeDefined();
    });

    it('should replace the did document with the one provided in the payload', async () => {
      const payload = getRecoverPayload(
        didUniqueSuffix,
        didDocumentModel2,
        recoveryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(payload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument.publicKey[0].publicKeyHex).toBe(primaryKey2.publicKey);
      expect(didDocument.publicKey[1].publicKeyHex).toBe(
        recoveryKey2.publicKey
      );
      expect(didDocument.id).toContain(didUniqueSuffix);
    });
  });

  describe('delete', () => {
    const mks = new MnemonicKeySystem(MnemonicKeySystem.generateMnemonic());
    let didUniqueSuffix;
    let primaryKey;
    let recoveryKey;

    beforeAll(async () => {
      primaryKey = mks.getKeyForPurpose('primary', 0);
      recoveryKey = mks.getKeyForPurpose('recovery', 0);
      const didDocumentModel = getDidDocumentModel(
        primaryKey.publicKey,
        recoveryKey.publicKey
      );
      const createPayload = getCreatePayload(didDocumentModel, primaryKey);
      await sidetree.batchScheduler.writeNow(createPayload);
      didUniqueSuffix = getDidUniqueSuffix(createPayload);
    });

    it('should not work if specified kid does not exist in did document', async () => {
      const deletePayload = getDeletePayload(
        didUniqueSuffix,
        recoveryKey.privateKey
      );
      const invalidDeletePayload = changeKid(deletePayload, '#invalidKid');
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidDeletePayload,
        didUniqueSuffix
      );
      expect(didDocument.id).toBeDefined();
    });

    it('should not work if signature is not valid', async () => {
      const invalidDeletePayload = getDeletePayload(
        didUniqueSuffix,
        primaryKey.privateKey
      );
      const didDocument = await getDidDocumentForPayload(
        sidetree,
        invalidDeletePayload,
        didUniqueSuffix
      );
      expect(didDocument.id).toBeDefined();
    });

    it('should not work if there is no corresponding create operation', async () => {
      const fakeDidUniqueSuffix = 'fakediduniquesuffix';
      const invalidDeletePayload = getDeletePayload(
        fakeDidUniqueSuffix,
        recoveryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(invalidDeletePayload);
      const didDocument = await sidetree.resolve(fakeDidUniqueSuffix, true);
      expect(didDocument).not.toBeDefined();
    });

    it('should delete a did document', async () => {
      const deletePayload = getDeletePayload(
        didUniqueSuffix,
        recoveryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(deletePayload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument).not.toBeDefined();
    });

    it('should return null if two delete operations are sent for the same did', async () => {
      const secondDeletePayload = getDeletePayload(
        didUniqueSuffix,
        recoveryKey.privateKey
      );
      await sidetree.batchScheduler.writeNow(secondDeletePayload);
      const didDocument = await sidetree.resolve(didUniqueSuffix, true);
      expect(didDocument).not.toBeDefined();
    });
  });
});

describe('resolve just in time', () => {
  describe('create', () => {
    const mks = new MnemonicKeySystem(MnemonicKeySystem.generateMnemonic());
    let createPayload1;
    let createPayload2;
    let createPayload3;
    let didUniqueSuffix1;
    let didUniqueSuffix2;
    let didUniqueSuffix3;

    beforeAll(async () => {
      await sidetree.db.deleteDB();
      // Create a first transaction with two operations
      createPayload1 = await getCreatePayloadForKeyIndex(mks, 0);
      createPayload2 = await getCreatePayloadForKeyIndex(mks, 1);
      didUniqueSuffix1 = getDidUniqueSuffix(createPayload1);
      didUniqueSuffix2 = getDidUniqueSuffix(createPayload2);
      await sidetree.operationQueue.enqueue(didUniqueSuffix1, createPayload1);
      await sidetree.operationQueue.enqueue(didUniqueSuffix2, createPayload2);
      await sidetree.batchWrite();
      // Create a second transaction with one other operation
      createPayload3 = await getCreatePayloadForKeyIndex(mks, 2);
      didUniqueSuffix3 = getDidUniqueSuffix(createPayload3);
      await sidetree.operationQueue.enqueue(didUniqueSuffix3, createPayload3);
      await sidetree.batchWrite();
    });

    it('should resolve the did just in time without syncing first', async () => {
      const didDocument = await sidetree.resolve(didUniqueSuffix1, true);
      expect(didDocument.id).toContain(didUniqueSuffix1);
    });

    it('should only have synced one of the three operations', async () => {
      const operations1 = await sidetree.db.readCollection(didUniqueSuffix1);
      expect(operations1).toHaveLength(1);
      const operations2 = await sidetree.db.readCollection(didUniqueSuffix2);
      expect(operations2).toHaveLength(0);
      const operations3 = await sidetree.db.readCollection(didUniqueSuffix3);
      expect(operations3).toHaveLength(0);
    });
  });
});
