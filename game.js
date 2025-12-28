import { sdk } from 'https://esm.sh/@farcaster/frame-sdk';
import { ethers } from 'https://esm.sh/ethers@6.9.0';

// Initialize Farcaster SDK
sdk.actions.ready();

// Game Configuration
const ENTRY_FEE = '0.0001'; // ETH
const BASE_CHAIN_ID = '0x2105'; // Base Mainnet (8453)

// Contract ABI (minimal for the game)
const CONTRACT_ABI = [
    {
        "inputs": [{"internalType": "uint8", "name": "_guess", "type": "uint8"}],
        "name": "play",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getPoolBalance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "player", "type": "address"},
            {"indexed": false, "internalType": "uint8", "name": "guess", "type": "uint8"},
            {"indexed": false, "internalType": "uint8", "name": "winningNumber", "type": "uint8"},
            {"indexed": false, "internalType": "bool", "name": "won", "type": "bool"},
            {"indexed": false, "internalType": "uint256", "name": "prize", "type": "uint256"}
        ],
        "name": "GamePlayed",
        "type": "event"
    }
];

// Contract address - Deployed on Base (v2: winner gets 50%)
const CONTRACT_ADDRESS = '0x8b28c26f733c6c0c978d76aa4f8ab5aa13f6f8b2';

// State
let selectedNumber = null;
let walletConnected = false;
let userAddress = null;
let provider = null;

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const walletInfo = document.getElementById('walletInfo');
const walletAddress = document.getElementById('walletAddress');
const walletBalance = document.getElementById('walletBalance');
const poolAmount = document.getElementById('poolAmount');
const selectedDisplay = document.getElementById('selectedNumber');
const submitBtn = document.getElementById('submitBtn');
const resultModal = document.getElementById('resultModal');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultMessage = document.getElementById('resultMessage');
const closeModal = document.getElementById('closeModal');
const historyList = document.getElementById('historyList');
const numberBtns = document.querySelectorAll('.number-btn');

// Initialize
async function init() {
    setupEventListeners();
    loadHistory();
    // Fetch pool balance on load
    updatePoolDisplay();
    
    // Auto-connect if in Farcaster
    try {
        const context = await sdk.context;
        if (context && context.user) {
            console.log('In Farcaster context:', context.user);
        }
    } catch (e) {
        console.log('Not in Farcaster context');
    }
}

// Event Listeners
function setupEventListeners() {
    // Wallet connection
    connectBtn.addEventListener('click', handleConnect);
    
    // Number selection
    numberBtns.forEach(btn => {
        btn.addEventListener('click', () => selectNumber(btn));
        // Touch support
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            selectNumber(btn);
        });
    });
    
    // Submit guess
    submitBtn.addEventListener('click', handleSubmit);
    submitBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleSubmit();
    });
    
    // Close modal
    closeModal.addEventListener('click', hideModal);
    closeModal.addEventListener('touchend', (e) => {
        e.preventDefault();
        hideModal();
    });
    
    // Click outside modal to close
    resultModal.addEventListener('click', (e) => {
        if (e.target === resultModal) hideModal();
    });
}

// Wallet Connection
async function handleConnect() {
    if (walletConnected) return;
    
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;
    
    try {
        // Try Farcaster SDK first (for mobile in Farcaster app)
        let accounts = [];
        
        try {
            // Check if we're in Farcaster context
            const context = await sdk.context;
            if (context && context.user) {
                // Use Farcaster's wallet provider
                const ethProvider = await sdk.wallet.ethProvider;
                if (ethProvider) {
                    provider = ethProvider;
                    accounts = await provider.request({ method: 'eth_requestAccounts' });
                }
            }
        } catch (fcError) {
            console.log('Not in Farcaster context, trying browser wallet');
        }
        
        // Fall back to browser wallet (MetaMask, etc.)
        if (accounts.length === 0) {
            if (typeof window.ethereum === 'undefined') {
                // Open wallet connect or show instructions
                const useWalletConnect = confirm('No wallet found. Open in wallet browser?\n\nClick OK to copy the link, then paste in your wallet browser.');
                if (useWalletConnect) {
                    navigator.clipboard.writeText(window.location.href);
                    alert('Link copied! Paste it in your wallet browser (MetaMask, Coinbase Wallet, etc.)');
                }
                throw new Error('Please open this app in a wallet browser');
            }
            
            provider = window.ethereum;
            accounts = await provider.request({ method: 'eth_requestAccounts' });
        }
        
        if (accounts.length === 0) {
            throw new Error('No accounts found');
        }
        
        userAddress = accounts[0];
        
        // Check and switch to Base network
        await switchToBase();
        
        // Update UI
        walletConnected = true;
        connectBtn.classList.add('hidden');
        walletInfo.classList.remove('hidden');
        walletAddress.textContent = formatAddress(userAddress);
        
        // Get balance
        await updateBalance();
        
        // Update submit button state
        updateSubmitButton();
        
        // Listen for account changes (only for browser wallets)
        if (provider.on) {
            provider.on('accountsChanged', handleAccountChange);
            provider.on('chainChanged', () => window.location.reload());
        }
        
    } catch (error) {
        console.error('Connection error:', error);
        alert(error.message || 'Failed to connect wallet');
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.disabled = false;
    }
}

async function switchToBase() {
    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }]
        });
    } catch (switchError) {
        // Chain not added, try to add it
        if (switchError.code === 4902) {
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: BASE_CHAIN_ID,
                    chainName: 'Base',
                    nativeCurrency: {
                        name: 'Ethereum',
                        symbol: 'ETH',
                        decimals: 18
                    },
                    rpcUrls: ['https://mainnet.base.org'],
                    blockExplorerUrls: ['https://basescan.org']
                }]
            });
        } else {
            throw switchError;
        }
    }
}

async function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        // Disconnected
        walletConnected = false;
        userAddress = null;
        connectBtn.classList.remove('hidden');
        walletInfo.classList.add('hidden');
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.disabled = false;
        updateSubmitButton();
    } else {
        userAddress = accounts[0];
        walletAddress.textContent = formatAddress(userAddress);
        await updateBalance();
    }
}

async function updateBalance() {
    if (!userAddress || !provider) return;
    
    try {
        const balance = await provider.request({
            method: 'eth_getBalance',
            params: [userAddress, 'latest']
        });
        const ethBalance = parseInt(balance, 16) / 1e18;
        walletBalance.textContent = `${ethBalance.toFixed(4)} ETH`;
    } catch (error) {
        console.error('Balance error:', error);
    }
}

// Number Selection
function selectNumber(btn) {
    // Remove previous selection
    numberBtns.forEach(b => b.classList.remove('selected'));
    
    // Select new number
    btn.classList.add('selected');
    selectedNumber = parseInt(btn.dataset.number);
    selectedDisplay.textContent = selectedNumber;
    
    // Update submit button
    updateSubmitButton();
    
    // Haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

function updateSubmitButton() {
    submitBtn.disabled = !walletConnected || selectedNumber === null;
}

// Submit Guess
async function handleSubmit() {
    if (!walletConnected || selectedNumber === null) return;
    
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;
    
    try {
        // For demo without deployed contract, simulate the game
        if (CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') {
            await simulateGame();
        } else {
            await playOnChain();
        }
    } catch (error) {
        console.error('Game error:', error);
        alert(error.message || 'Transaction failed');
    } finally {
        submitBtn.textContent = 'Submit Guess';
        updateSubmitButton();
    }
}

// Simulate game (for demo/testing without deployed contract)
async function simulateGame() {
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Generate random winning number
    const winningNumber = Math.floor(Math.random() * 10) + 1;
    const won = selectedNumber === winningNumber;
    
    // Calculate prize (simulated)
    const prize = won ? parseFloat(poolAmount.textContent) + parseFloat(ENTRY_FEE) : 0;
    
    // Show result
    showResult(won, selectedNumber, winningNumber, prize);
    
    // Add to history
    addToHistory(selectedNumber, winningNumber, won);
    
    // Update pool (simulated)
    if (!won) {
        const currentPool = parseFloat(poolAmount.textContent);
        poolAmount.textContent = (currentPool + parseFloat(ENTRY_FEE)).toFixed(3);
    } else {
        poolAmount.textContent = '0.000';
    }
    
    // Reset selection
    resetSelection();
}

// Play on-chain (when contract is deployed)
async function playOnChain() {
    // Create contract interface for proper encoding
    const contractABI = [
        "function play(uint8 _guess) external payable"
    ];
    
    const iface = new ethers.Interface(contractABI);
    const functionData = iface.encodeFunctionData("play", [selectedNumber]);
    
    // Entry fee: 0.0001 ETH
    const entryFeeWei = ethers.parseEther("0.0001").toString(16);
    
    console.log('Sending transaction:', {
        to: CONTRACT_ADDRESS,
        value: '0x' + entryFeeWei,
        data: functionData,
        guess: selectedNumber
    });
    
    // Send transaction
    const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
            from: userAddress,
            to: CONTRACT_ADDRESS,
            value: '0x' + entryFeeWei,
            data: functionData
        }]
    });
    
    console.log('Transaction sent:', txHash);
    
    // Show pending state
    submitBtn.textContent = 'Confirming...';
    
    // Wait for transaction receipt
    let receipt = null;
    let attempts = 0;
    while (!receipt && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
        try {
            receipt = await provider.request({
                method: 'eth_getTransactionReceipt',
                params: [txHash]
            });
        } catch (e) {
            console.log('Waiting for confirmation...', attempts);
        }
    }
    
    if (!receipt) {
        throw new Error('Transaction timeout - check your wallet');
    }
    
    console.log('Receipt:', receipt);
    
    // Check if transaction succeeded
    const success = receipt.status === '0x1';
    
    let won = false;
    let winningNumber = Math.floor(Math.random() * 10) + 1;
    let prize = 0;
    
    // Try to parse GamePlayed event
    if (success && receipt.logs && receipt.logs.length > 0) {
        try {
            const log = receipt.logs[0];
            if (log.data && log.data.length > 2) {
                const dataHex = log.data.slice(2);
                // Data: guess(32) + winningNumber(32) + won(32) + prize(32)
                if (dataHex.length >= 256) {
                    const guessFromLog = parseInt(dataHex.slice(0, 64), 16);
                    winningNumber = parseInt(dataHex.slice(64, 128), 16);
                    won = parseInt(dataHex.slice(128, 192), 16) === 1;
                    prize = parseInt(dataHex.slice(192, 256), 16) / 1e18;
                    console.log('Parsed event:', { guessFromLog, winningNumber, won, prize });
                }
            }
        } catch (e) {
            console.log('Could not parse event:', e);
        }
    }
    
    // Show result
    showResult(won, selectedNumber, winningNumber, prize);
    
    // Add to history
    addToHistory(selectedNumber, winningNumber, won);
    
    // Update pool display
    await updatePoolDisplay();
    
    // Update balance
    await updateBalance();
    
    // Reset selection
    resetSelection();
}

// Show Result Modal
function showResult(won, guess, winningNumber, prize) {
    if (won) {
        resultIcon.textContent = '🎉';
        resultTitle.textContent = 'You Won!';
        resultTitle.style.color = 'var(--accent-green)';
        resultMessage.textContent = `The number was ${winningNumber}. You won ${prize.toFixed(4)} ETH!`;
    } else {
        resultIcon.textContent = '😔';
        resultTitle.textContent = 'Not This Time';
        resultTitle.style.color = 'var(--accent-red)';
        resultMessage.textContent = `The number was ${winningNumber}. Your guess was ${guess}. Try again!`;
    }
    
    resultModal.classList.remove('hidden');
}

function hideModal() {
    resultModal.classList.add('hidden');
}

// History Management
function addToHistory(guess, winningNumber, won) {
    const history = getHistory();
    history.unshift({
        guess,
        winningNumber,
        won,
        timestamp: Date.now()
    });
    
    // Keep only last 10 games
    if (history.length > 10) {
        history.pop();
    }
    
    localStorage.setItem('gameHistory', JSON.stringify(history));
    renderHistory();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem('gameHistory')) || [];
    } catch {
        return [];
    }
}

function loadHistory() {
    renderHistory();
}

function renderHistory() {
    const history = getHistory();
    
    if (history.length === 0) {
        historyList.innerHTML = '<p class="no-history">No games played yet</p>';
        return;
    }
    
    historyList.innerHTML = history.map(game => `
        <div class="history-item">
            <span class="history-guess">Guessed ${game.guess} → ${game.winningNumber}</span>
            <span class="history-result ${game.won ? 'win' : 'lose'}">
                ${game.won ? 'WON' : 'LOST'}
            </span>
        </div>
    `).join('');
}

// Reset selection after game
function resetSelection() {
    selectedNumber = null;
    selectedDisplay.textContent = '-';
    numberBtns.forEach(b => b.classList.remove('selected'));
    updateSubmitButton();
}

// Update pool display
async function updatePoolDisplay() {
    // If contract is deployed, fetch real pool balance
    if (CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        try {
            // Call getPoolBalance() - selector: 0xb8a93086
            const result = await (provider || window.ethereum).request({
                method: 'eth_call',
                params: [{
                    to: CONTRACT_ADDRESS,
                    data: '0xb8a93086' // getPoolBalance() selector
                }, 'latest']
            });
            const poolWei = parseInt(result, 16);
            poolAmount.textContent = (poolWei / 1e18).toFixed(4);
        } catch (error) {
            console.error('Pool fetch error:', error);
            poolAmount.textContent = '0.0000';
        }
    }
}

// Format address for display
function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Initialize app
init();

