import {
  Connection,
  PublicKey,
  SignatureStatus,
  Signer,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import Transport from "@ledgerhq/hw-transport-node-hid";
export * as Transport from "@ledgerhq/hw-transport-node-hid";

const INS_GET_APP_CONFIG = 0x04;
const INS_GET_PUBKEY = 0x05;
const INS_SIGN_MESSAGE = 0x06;
const P1_NON_CONFIRM = 0x00;
const P1_CONFIRM = 0x01;
const P2_EXTEND = 0x01;
const P2_MORE = 0x02;
const MAX_PAYLOAD = 255;
const LEDGER_CLA = 0xe0;

async function solanaSend(
  transport: Transport,
  instruction: number,
  p1: number,
  payload: Buffer
) {
  var p2 = 0;
  var payload_offset = 0;
  console.log(4);

  if (payload.length > MAX_PAYLOAD) {
    while (payload.length - payload_offset > MAX_PAYLOAD) {
      const buf = payload.slice(payload_offset, payload_offset + MAX_PAYLOAD);
      payload_offset += MAX_PAYLOAD;
      console.log(
        "send",
        (p2 | P2_MORE).toString(16),
        buf.length.toString(16),
        buf
      );
      const reply = await transport.send(
        LEDGER_CLA,
        instruction,
        p1,
        p2 | P2_MORE,
        buf
      );
      if (reply.length != 2) {
        //@ts-ignore
        throw new TransportError(
          "solanaSend: Received unexpected reply payload",
          "UnexpectedReplyPayload"
        );
      }
      p2 |= P2_EXTEND;
    }
  }
  console.log(5);

  const buf = payload.slice(payload_offset);
  console.log(6);

  console.log("send", p2.toString(16), buf.length.toString(16), buf);
  const reply = await transport.send(LEDGER_CLA, instruction, p1, p2, buf);
  console.log(7);

  return reply.slice(0, reply.length - 2);
}

const BIP32_HARDENED_BIT = (1 << 31) >>> 0;
function _harden(n: any) {
  return (n | BIP32_HARDENED_BIT) >>> 0;
}

export function solanaDerivationPath(account?: number, change?: number) {
  var length;
  if (typeof account === "number") {
    if (typeof change === "number") {
      length = 4;
    } else {
      length = 3;
    }
  } else {
    length = 2;
  }

  var derivation_path = Buffer.alloc(1 + length * 4);
  var offset = 0;
  offset = derivation_path.writeUInt8(length, offset);
  offset = derivation_path.writeUInt32BE(_harden(44), offset); // Using BIP44
  offset = derivation_path.writeUInt32BE(_harden(501), offset); // Solana's BIP44 path

  if (length > 2) {
    offset = derivation_path.writeUInt32BE(_harden(account), offset);
    if (length == 4) {
      offset = derivation_path.writeUInt32BE(_harden(change), offset);
    }
  }

  return derivation_path;
}

async function solanaLedgerGetAppConfig(transport: Transport) {
  const reply = await transport.send(
    LEDGER_CLA,
    INS_GET_APP_CONFIG,
    P1_NON_CONFIRM,
    0,
    Buffer.alloc(0)
  );

  return reply.slice(0, reply.length - 2);
}

export async function solanaLedgerGetPubkey(
  transport: Transport,
  derivation_path: Buffer
) {
  return solanaSend(transport, INS_GET_PUBKEY, P1_NON_CONFIRM, derivation_path);
}

async function solanaLedgerSignTransaction(
  transport: Transport,
  derivation_path: Buffer,
  transaction: Transaction
) {
  const msg_bytes = transaction.compileMessage().serialize();

  console.log(1);
  // XXX: Ledger app only supports a single derivation_path per call ATM
  var num_paths = Buffer.alloc(1);
  num_paths.writeUInt8(1);
  console.log(2);

  const payload = Buffer.concat([num_paths, derivation_path, msg_bytes]);
  console.log(3);

  return solanaSend(transport, INS_SIGN_MESSAGE, P1_CONFIRM, payload);
}

export const solanaLedgerSignTx = async ({
  transport,
  tx,
  signer,
  account,
  change,
}: {
  transport: Transport;
  tx: Transaction;
  signer: PublicKey;
  account?: number;
  change?: number;
}) => {
  console.log("🚀 Begin signing with ledger...");
  // const transport = await Transport.open(undefined);

  const app_config = await solanaLedgerGetAppConfig(transport);
  console.log("App config:", app_config);

  const from_derivation_path = solanaDerivationPath(account, change);
  let sig_bytes = await solanaLedgerSignTransaction(
    transport,
    from_derivation_path,
    tx
  );
  let sig_string = bs58.encode(sig_bytes);
  console.log("Sig len:", sig_bytes.length, "sig:", sig_string);

  // Verify transfer signature
  tx.addSignature(signer, sig_bytes);
  console.log("✅ Sig verifies:", tx.verifySignatures());
};

export const solanaLedgerSendAndConfirmTx = async ({
  transport,
  conn,
  tx,
  ledgerSigner,
  timeoutMs = 60 * 1000,
  delayMs = 5 * 1000,
}: {
  transport: Transport;
  conn: Connection;
  tx: Transaction;
  extraSigners?: Signer[];
  // Prints out transaction (w/ logs) to stdout
  debug?: boolean;
  timeoutMs?: number;
  delayMs?: number;
  ledgerSigner: PublicKey;
}) => {
  await solanaLedgerSignTx({ transport, tx, signer: ledgerSigner });

  try {
    // for LEDGER have to use this method or get sig verification error
    const sig = await conn.sendRawTransaction(tx.serialize());

    const p = performance.now();
    let status: SignatureStatus | null = null;
    while (performance.now() - p < timeoutMs) {
      status = (await conn.getSignatureStatus(sig)).value;
      if (status !== null) break;
      await new Promise((res) => setTimeout(res, delayMs));
    }
    return { status, sig };
  } catch (e) {
    //this is needed to see program error logs
    console.error("❌ FAILED TO SEND TX, FULL ERROR: ❌");
    console.error(e);
    throw e;
  }
};
