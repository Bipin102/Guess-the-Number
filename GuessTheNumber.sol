// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract GuessTheNumber {
    address public owner;
    uint256 public entryFee = 0.0001 ether;
    uint256 public poolBalance;
    
    event GamePlayed(
        address indexed player,
        uint8 guess,
        uint8 winningNumber,
        bool won,
        uint256 prize
    );
    
    event PoolUpdated(uint256 newBalance);
    
    constructor() {
        owner = msg.sender;
    }
    
    function play(uint8 _guess) external payable {
        require(_guess >= 1 && _guess <= 10, "Guess must be between 1 and 10");
        require(msg.value >= entryFee, "Insufficient entry fee");
        
        // Add entry fee to pool
        poolBalance += msg.value;
        
        // Generate random number (1-10)
        // Note: This is pseudo-random and not secure for high-stakes games
        uint8 winningNumber = uint8((uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            poolBalance
        ))) % 10) + 1);
        
        bool won = (_guess == winningNumber);
        uint256 prize = 0;
        
        if (won) {
            // Winner gets 50% of the pool, 50% stays for next winner
            prize = poolBalance / 2;
            poolBalance = poolBalance - prize;
            
            // Transfer prize to winner
            (bool success, ) = payable(msg.sender).call{value: prize}("");
            require(success, "Transfer failed");
        }
        
        emit GamePlayed(msg.sender, _guess, winningNumber, won, prize);
        emit PoolUpdated(poolBalance);
    }
    
    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
    
    // Owner can seed the initial pool
    function seedPool() external payable {
        require(msg.value > 0, "Must send ETH");
        poolBalance += msg.value;
        emit PoolUpdated(poolBalance);
    }
    
    // Owner can withdraw if needed (emergency only)
    function emergencyWithdraw() external {
        require(msg.sender == owner, "Only owner");
        uint256 amount = poolBalance;
        poolBalance = 0;
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Transfer failed");
    }
}

