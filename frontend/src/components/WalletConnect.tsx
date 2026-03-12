import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

interface WalletConnectProps {
  onConnect: (account: string, provider: any) => void;
  onDisconnect: () => void;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ onConnect, onDisconnect }) => {
  const [account, setAccount] = useState<string | null>(null);
  const [network, setNetwork] = useState<string>('');

  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_accounts", []);
        
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          onConnect(accounts[0], provider);
          
          // Get network info
          const network = await provider.getNetwork();
          setNetwork(network.name || 'Unknown Network');
        }
      }
    };

    init();
  }, []);

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        const account = accounts[0];
        setAccount(account);
        onConnect(account, provider);

        // Get network info
        const network = await provider.getNetwork();
        setNetwork(network.name || 'Unknown Network');
      } catch (error) {
        console.error("Error connecting wallet:", error);
      }
    } else {
      alert("Please install MetaMask!");
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setNetwork('');
    onDisconnect();
  };

  const switchToSepolia = async () => {
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }], // Sepolia chain ID
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0xaa36a7',
                  chainName: 'Sepolia Testnet',
                  rpcUrls: ['https://sepolia.infura.io/v3/'],
                  nativeCurrency: {
                    name: 'Sepolia Ether',
                    symbol: 'SEP',
                    decimals: 18,
                  },
                  blockExplorerUrls: ['https://sepolia.etherscan.io'],
                },
              ],
            });
          } catch (addError) {
            console.error("Error adding network:", addError);
          }
        }
      }
    }
  };

  return (
    <div className="wallet-connect">
      {account ? (
        <div className="connected">
          <span>Connected: {account.substring(0, 6)}...{account.substring(account.length - 4)}</span>
          <span>Network: {network}</span>
          <button onClick={switchToSepolia}>Switch to Sepolia</button>
          <button onClick={disconnectWallet}>Disconnect</button>
        </div>
      ) : (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}
    </div>
  );
};

export default WalletConnect;