import { ethers } from "ethers";
import * as fs from "fs";

async function main() {
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const contractAddresses = JSON.parse(fs.readFileSync("../frontend/src/contract-addresses.json", "utf8"));

  console.log("MockToken address:", contractAddresses.MOCK_TOKEN);

  const acc = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Test arbitrary acc

  const tokenContract = new ethers.Contract(
    contractAddresses.MOCK_TOKEN,
    [
      "function balanceOf(address account) public view returns (uint256)"
    ],
    provider
  );

  try {
    const bal = await tokenContract.balanceOf(acc);
    console.log("balanceOf:", bal.toString());
  } catch (e: any) {
    console.log("Error calling mockToken:", e.message);
  }

  const tradeManagerAbi = [
    "function getTrade(uint256 _tradeId) external view returns (tuple(uint256 id, address buyer, address seller, string commodityType, uint256 quantity, string unit, uint256 pricePerUnit, address paymentToken, string incoterms, uint256 shipmentId, uint256 expiryTimestamp, uint256 disputeWindowEnds, uint256 depositAmount, uint8 status, uint256 createdAt, bytes32 buyerSignatureHash, bytes32 sellerSignatureHash, bytes32 finalConfirmationHash))"
  ];

  const tm = new ethers.Contract(contractAddresses.TRADE_MANAGER, tradeManagerAbi, provider);

  try {
    const t = await tm.getTrade(1);
    console.log("trade.paymentToken:", t.paymentToken);

    if (t.paymentToken) {
      const inlineToken = new ethers.Contract(
        t.paymentToken,
        ["function balanceOf(address account) public view returns (uint256)"],
        provider
      );
      const b2 = await inlineToken.balanceOf(acc);
      console.log("Inline token balance:", b2.toString());
    } else {
      console.log("PaymentToken is undefined");
    }
  } catch (e: any) {
    console.log("Trade fetch error:", e.message);
  }
}

main();
