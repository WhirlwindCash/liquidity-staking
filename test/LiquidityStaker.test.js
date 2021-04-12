require("chai")
  .use(require("bn-chai")(web3.utils.BN))
  .use(require("chai-as-promised"))
  .should();

const TestERC20 = artifacts.require("./TestERC20.sol");
const Staker = artifacts.require("./LiquidityStaker.sol");

// 17 zeroes to create a value accurate to the tenth decimal place
// Required as the WIND per block is 1e17
let TENTH_DECIMAL = "0".repeat(17);

function logFormat(data) {
  if (typeof(data) == "string") {
    return "0x" + data.substr(2).toLowerCase().padStart(64, "0");
  } else {
    return "0x" + (new web3.utils.BN(data)).toString(16).padStart(64, "0");
  }
}

function checkTransfer(log, token, from, to, amount) {
  assert.strictEqual(log.address, token);
  assert.strictEqual(log.data, logFormat(amount));
  assert.deepEqual(log.topics, [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    logFormat(from),
    logFormat(to)
  ]);
}

function checkApproval(log) {
  assert.strictEqual(log.topics[0], "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925");
}

function checkDeposit(log, from, amount, divisor) {
  assert.deepEqual(log.topics, [
    "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15",
    logFormat(from)
  ]);
  assert.strictEqual(log.data, logFormat(amount) + logFormat(divisor).substr(2));
}

function checkRewards(log, from, amount, divisor) {
  assert.deepEqual(log.topics, [
    "0x61953b03ced70bb23c53b5a7058e431e3db88cf84a72660faea0849b785c43bd",
    logFormat(from)
  ]);
  assert.strictEqual(log.data, logFormat(amount) + logFormat(divisor).substr(2));
}

function checkWithdraw(log, from, amount) {
  assert.deepEqual(log.topics, [
    "0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364",
    logFormat(from)
  ]);
  assert.strictEqual(log.data, logFormat(amount));
}

contract("WIND", accounts => {
  let staker;
  let whirlwind;

  beforeEach(async () => {
    wind = await TestERC20.new();
    lp = await TestERC20.new();
    staker = await Staker.new(wind.address, lp.address);

    // Send it 10 WIND to use as rewards
    await wind.transfer(staker.address, "100" + TENTH_DECIMAL);

    // Authorize it to spend our LP tokens
    for (let i = 0; i < 2; i++) {
      await lp.approve(staker.address, "1000" + TENTH_DECIMAL, {from: accounts[i]});
    }
  });

  it("should allow depositing, claiming rewards, and withdrawing", async () => {
    // Deposit
    let deposit = await staker.deposit(3);
    checkTransfer(deposit.receipt.rawLogs[0], lp.address, accounts[0], staker.address, 3);
    checkApproval(deposit.receipt.rawLogs[1]);
    checkDeposit(deposit.receipt.rawLogs[2], accounts[0], 3, 1);

    // Check balances/getStakedAmount
    (await lp.balanceOf.call(staker.address)).should.be.eq.BN(3);
    (await lp.balanceOf.call(accounts[0])).should.be.eq.BN("99" + "9".repeat(17) + "7");
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("3");

    // Since we have 100% of the rewards and the deposit also created a block
    // We should be able to now claim 0.1 WIND

    // Check divisors and getRewards
    (await staker.getCurrentDivisorForPool.call(accounts[0])).should.be.eq.BN("1");
    (await staker.getPercentageDivisor.call(accounts[0])).should.be.eq.BN("1");
    // Should be one block's reward since we're the entire pool
    // Creates a meaningless transaction beforehand due to truffle using the curent block, not the pending block
    await web3.eth.sendTransaction({from: accounts[0], to: accounts[0]});
    let reward = (await staker.getRewards.call(accounts[0]))["0"].should.be.eq.BN("1" + TENTH_DECIMAL);

    // Claim the rewards
    let rewards = await staker.claimRewards(accounts[0]);
    checkTransfer(rewards.receipt.rawLogs[0], wind.address, staker.address, accounts[0], new web3.utils.BN("2" + TENTH_DECIMAL));
    checkRewards(rewards.receipt.rawLogs[1], accounts[0], new web3.utils.BN("2" + TENTH_DECIMAL), 1);

    // Confirm balances
    // Actually 2 blocks of rewards due to what's explained above
    (await wind.balanceOf.call(accounts[0])).should.be.eq.BN("902" + TENTH_DECIMAL);
    (await wind.balanceOf.call(staker.address)).should.be.eq.BN("98" + TENTH_DECIMAL);

    await web3.eth.sendTransaction({from: accounts[0], to: accounts[0]});
    // Now that another block has passed...
    (await staker.getRewards.call(accounts[0]))["0"].should.be.eq.BN("1" + TENTH_DECIMAL);

    // Test partial withdrawals and accurate reward calculation using existing balance
    let withdrawal = await staker.withdraw(2);
    checkTransfer(withdrawal.receipt.rawLogs[0], wind.address, staker.address, accounts[0], new web3.utils.BN("2" + TENTH_DECIMAL));
    checkRewards(withdrawal.receipt.rawLogs[1], accounts[0], new web3.utils.BN("2" + TENTH_DECIMAL), 1);
    checkTransfer(withdrawal.receipt.rawLogs[2], lp.address, staker.address, accounts[0], 2);
    checkWithdraw(withdrawal.receipt.rawLogs[3], accounts[0], 2);

    // Staked amount should be set to 1
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("1");

    // Withdraw that 1
    await staker.withdraw(1);
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("0");

    // Double check balances
    (await wind.balanceOf.call(accounts[0])).should.be.eq.BN("905" + TENTH_DECIMAL);
    (await wind.balanceOf.call(staker.address)).should.be.eq.BN("95" + TENTH_DECIMAL);

    (await lp.balanceOf.call(staker.address)).should.be.eq.BN(0);
    (await lp.balanceOf.call(accounts[0])).should.be.eq.BN("1000" + TENTH_DECIMAL);
  });

  it("should allow you to deposit more", async () => {
    // Deposit
    let deposit = await staker.deposit(1);
    checkTransfer(deposit.receipt.rawLogs[0], lp.address, accounts[0], staker.address, 1);
    checkApproval(deposit.receipt.rawLogs[1]);
    checkDeposit(deposit.receipt.rawLogs[2], accounts[0], 1, 1);

    // Check getStakedAmount
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("1");

    // Deposit more
    deposit = await staker.deposit(2);
    checkTransfer(deposit.receipt.rawLogs[0], wind.address, staker.address, accounts[0], new web3.utils.BN("1" + TENTH_DECIMAL));
    checkRewards(deposit.receipt.rawLogs[1], accounts[0], new web3.utils.BN("1" + TENTH_DECIMAL), 1);
    checkTransfer(deposit.receipt.rawLogs[2], lp.address, accounts[0], staker.address, 2);
    checkApproval(deposit.receipt.rawLogs[3]);
    checkDeposit(deposit.receipt.rawLogs[4], accounts[0], 2, 1);

    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("3");

    // Rewards shouldn't be anything notable as the divisor remained constant
    let rewards = await staker.claimRewards(accounts[0]);
    checkTransfer(rewards.receipt.rawLogs[0], wind.address, staker.address, accounts[0], new web3.utils.BN("1" + TENTH_DECIMAL));
    checkRewards(rewards.receipt.rawLogs[1], accounts[0], new web3.utils.BN("1" + TENTH_DECIMAL), 1);
  });

  it("should allow anyone to trigger a claim for anyone", async () => {
    await staker.deposit(1);
    // Sanity check
    assert.strictEqual((await staker.claimRewards(accounts[0], { from: accounts[1] })).receipt.from, accounts[1].toLowerCase());
    (await wind.balanceOf.call(accounts[0])).should.be.eq.BN("901" + TENTH_DECIMAL);
    (await wind.balanceOf.call(accounts[1])).should.be.eq.BN(0);
    (await wind.balanceOf.call(staker.address)).should.be.eq.BN("99" + TENTH_DECIMAL);
  });

  it("should correctly scale the divisor based on the original divisor", async () => {
    await staker.deposit(1);
    await lp.transfer(accounts[1], 3);
    await staker.deposit(3, { from: accounts[1] });

    // Should use a divisor of 2
    // Base of 1, new of 4, 5 // 2
    (await staker.getRewards.call(accounts[0]))["1"].should.be.eq.BN("2");
  });

  it("should update the original divisor if a lower one is now available", async () => {
    await staker.deposit(10);
    await lp.transfer(accounts[1], 1);
    await staker.deposit(1, { from: accounts[1] });

    // Original divisor is now 11
    await staker.withdraw(10);

    // Call getRewards and verify it has a divisor of 1, not 6
    (await staker.getRewards.call(accounts[1]))["1"].should.be.eq.BN("1");
    await staker.claimRewards(accounts[1]);

    // Now deposit the 10 again and verify the divisor is 6
    await staker.deposit(10);
    (await staker.getRewards.call(accounts[1]))["1"].should.be.eq.BN("6");
  });

  it("should allow withdrawing without claiming rewards", async () => {
    await staker.deposit(1);
    let withdrawal = await staker.emergencyWithdraw();
    assert.strictEqual(withdrawal.receipt.rawLogs.length, 2);
    checkTransfer(withdrawal.receipt.rawLogs[0], lp.address, staker.address, accounts[0], 1);
    checkWithdraw(withdrawal.receipt.rawLogs[1], accounts[0], 1);
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("0");
  });

  it("shouldn't let you withdraw more than you have", async () => {
    await staker.deposit(1);
    let errored = false;
    try {
      await staker.withdraw(2);
    } catch(e) {
      errored = (e.toString() == "Error: Returned error: VM Exception while processing transaction: revert");
    }
    assert(errored);
  });
});
