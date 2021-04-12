// SPDX-License-Identifier: MIT

// Enables not using SafeMath
pragma solidity =0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract LiquidityStaker is ReentrancyGuard {
  using SafeERC20 for IERC20;

  IERC20 private _WIND;
  IERC20 private _LP;

  // WIND per block
  // Set to 0.1, which will mean 64800 per month
  // With an initial balance of 1 million, this will last roughly a year (see notes below on divisorOfPoolAtStart)
  // That said, it is technically long term viable due to potential arbitrary addition of Whirlwinds
  // That would allow using privacy mining funds as staking rewards
  // This is something to discuss down the road
  uint256 public constant WIND_PER_BLOCK = 1e17;

  struct Staker {
    // Block deposited on/most recent block they claimed rewards
    uint256 lastBlock;

    // Amount deposited
    uint256 amount;

    // Rewards are based on historical percent of LP pool and current percent
    // Encourages getting in early, yet also doesn't allow the first party to always claim 100%
    // Also moves distribution closer to target by not having potentially infinite amounts (always depositing more and more)
    // Still causes target exceedance; maximum of 250%, yet practical of ~150%
    uint256 divisorOfPoolAtStart;
  }
  mapping(address => Staker) private _stakers;

  event Deposit(address indexed staker, uint256 amount, uint256 divisorOfPool);
  event Rewards(address indexed staker, uint256 amount, uint256 divisorUsed);
  event Withdraw(address indexed staker, uint256 amount);

  constructor(address WIND, address LP) {
    _WIND = IERC20(WIND);
    _LP = IERC20(LP);
  }

  function getStakedAmount(address staker) external view returns (uint256) {
    return _stakers[staker].amount;
  }

  // Returns the divisor to use to get the staker's percentage weighted version of an amount
  function getCurrentDivisorForPool(address staker) public view returns (uint256) {
    // Will revert for non-stakers
    return _LP.balanceOf(address(this)) / _stakers[staker].amount;
  }

  function getPercentageDivisor(address staker) public returns (uint256) {
    uint256 currentDivisor = getCurrentDivisorForPool(staker);

    // The percent of pool at start is meant to reward early stakers
    // If late in life, stakes are withdrawn, then the currentDivisor would penalize older stakers
    // To solve this, update it to the lowest divisor found (the highest staked percentage version)
    if (currentDivisor < _stakers[staker].divisorOfPoolAtStart) {
      _stakers[staker].divisorOfPoolAtStart = currentDivisor;
    }

    return (_stakers[staker].divisorOfPoolAtStart + currentDivisor) / 2;
  }

  function getRewards(address staker) public returns (uint256, uint256) {
    // Prevent a revert when the divisor code is called
    if (_stakers[staker].amount == 0) {
      return (0, 0);
    }

    uint256 divisor = getPercentageDivisor(staker);
    return (
      (WIND_PER_BLOCK * (block.number - _stakers[staker].lastBlock)) / divisor,
      divisor
    );
  }

  function _claimRewards(address staker) internal {
    // A check if the last interaction block is the current block isn't needed
    // The block differential is a direct factor in the rewards calculation
    (uint256 rewards, uint256 divisor) = getRewards(staker);

    // Always update the last block due to usage below
    _stakers[staker].lastBlock = block.number;

    // Only call transfer when there's an amount
    if (rewards != 0) {
      _WIND.safeTransfer(staker, rewards);
      emit Rewards(staker, rewards, divisor);
    }
  }

  // nonReentrant for extra safety; none of these should NEED it
  function claimRewards(address staker) external nonReentrant {
    _claimRewards(staker);
  }

  function deposit(uint256 amount) external nonReentrant {
    // End meaningless transactions now and don't risk a transferFrom reversion later
    require(amount != 0, "LiquidityStaker: Cannot deposit 0 WIND");

    // If this is a new staker, create them
    if (_stakers[msg.sender].amount == 0) {
      _stakers[msg.sender] = Staker(
        block.number,
        amount,
        // Don't call getCurrentDivisorForPool as the LP transfer has yet to occur
        (_LP.balanceOf(address(this)) + amount) / amount
      );
      _LP.safeTransferFrom(msg.sender, address(this), amount);
      emit Deposit(msg.sender, amount, _stakers[msg.sender].divisorOfPoolAtStart);

      // Return now so we don't further edit this staker
      return;
    }

    // Else...
    // Claim existing rewards so this deposit doesn't clear them
    // Also updates last block
    _claimRewards(msg.sender);

    // Update the amount now before calling an external contract
    // Despite being trusted, checks, effects, interactions should always be followed
    _stakers[msg.sender].amount += amount;

    // Transfer the liquidity tokens
    _LP.safeTransferFrom(msg.sender, address(this), amount);

    emit Deposit(msg.sender, amount, _stakers[msg.sender].divisorOfPoolAtStart);
  }

  function withdraw(uint256 amount) external nonReentrant {
    // Update last block/prevent rewards from being cleared
    _claimRewards(msg.sender);

    _stakers[msg.sender].amount -= amount;

    // Transfer the LPs
    _LP.safeTransfer(msg.sender, amount);

    emit Withdraw(msg.sender, amount);
  }

  // Withdraw without claiming rewards
  // Used to stop funds from being trapped if LP rewards run out
  function emergencyWithdraw() external nonReentrant {
    uint256 amount = _stakers[msg.sender].amount;

    // Zero the staker's amount
    // This will cause them to be recognized as a new staker on the next deposit
    // Also prevents further emegency withdraws, of course
    _stakers[msg.sender].amount = 0;

    // Transfer the LPs
    _LP.safeTransfer(msg.sender, amount);

    emit Withdraw(msg.sender, amount);
  }
}
