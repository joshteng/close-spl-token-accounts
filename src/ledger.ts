import {
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import {
  solanaDerivationPath,
  solanaLedgerGetPubkey,
  solanaLedgerSignTx,
  Transport,
} from "@tensor-oss/ledger-solana-sdk";

const connection = new Connection(
  process.env["RPC"] || "https://api.mainnet-beta.solana.com"
);

const priorityFeeMicroLamports = 10000;
const ledgerAcc = 0;

async function main() {
  const transport = await Transport.default.open(undefined);
  const deriv = solanaDerivationPath(0, undefined);
  const user = new PublicKey(await solanaLedgerGetPubkey(transport, deriv));

  console.log(`pubkey for account ${0}: ${user.toBase58()}`);
  transport.close();

  console.log(`Closing all token accounts with 0 balance`);
  const latestBlockhashPromise = connection.getLatestBlockhash();
  const tokenAccountsToClose: PublicKey[] = [];
  const response = await connection.getTokenAccountsByOwner(user, {
    programId: TOKEN_PROGRAM_ID, // does not fetch token 2022 accounts
  });

  response.value.forEach((e) => {
    const accountInfo = AccountLayout.decode(e.account.data);
    if (accountInfo.amount === BigInt("0")) {
      tokenAccountsToClose.push(e.pubkey);
    }
  });

  const instructions: TransactionInstruction[] = [];

  tokenAccountsToClose.forEach((acc) => {
    instructions.push(createCloseAccountInstruction(acc, user, user));
  });

  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFeeMicroLamports,
    })
  );

  console.log(`Closing ${tokenAccountsToClose.length} token accounts`);

  const latestBlockhash = await latestBlockhashPromise;
  const tx = new Transaction().add(...instructions);
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = user;
  await solanaLedgerSignTx({
    tx,
    signer: user,
    account: ledgerAcc,
    // change: ledgerChange,
  });

  const txSig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "processed",
  });

  console.log(`Txn sent: https://explorer.solana.com/tx/${txSig}`);

  const confirmation = await connection.confirmTransaction(
    {
      ...latestBlockhash,
      signature: txSig,
    },
    "processed"
  );

  if (confirmation.value.err) throw confirmation.value.err;

  console.log(`Txn success: https://explorer.solana.com/tx/${txSig}`);
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
