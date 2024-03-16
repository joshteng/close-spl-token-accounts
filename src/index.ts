import {
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";

const connection = new Connection(
  process.env["RPC"] || "https://api.mainnet-beta.solana.com"
);

const user = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env["PRIVATE_KEY"]!))
);

const priorityFeeMicroLamports = 1000;

async function main() {
  console.log(`Closing all token accounts with 0 balance`);
  const latestBlockhashPromise = connection.getLatestBlockhash();
  const tokenAccountsToClose: PublicKey[] = [];
  const response = await connection.getTokenAccountsByOwner(user.publicKey, {
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
    instructions.push(
      createCloseAccountInstruction(acc, user.publicKey, user.publicKey)
    );
  });

  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFeeMicroLamports,
    })
  );

  console.log(`Closing ${tokenAccountsToClose.length} token accounts`);

  const latestBlockhash = await latestBlockhashPromise;
  const messageV0 = new TransactionMessage({
    payerKey: user.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([user]);

  const txSig = await connection.sendTransaction(tx, {
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
