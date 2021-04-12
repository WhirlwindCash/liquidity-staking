require("chai")
  .use(require("bn-chai")(web3.utils.BN))
  .use(require("chai-as-promised"))
  .should();

const TestERC20 = artifacts.require("./TestERC20.sol");
const Staker = artifacts.require("./LiquidityStaker.sol");

// 17 zeroes to create a value accurate to the tenth decimal place
// Required as the WIND per block is 1e17
let TENTH_DECIMAL = "0".repeat(17);

contract("WIND", accounts => {
  let staker;
  let whirlwind;

  before(async () => {
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

  // TODO check all events

  it("should allow depositing, claiming rewards, and withdrawing", async () => {
    // Deposit
    await staker.deposit(1);

    // Check balances/getStakedAmount
    (await lp.balanceOf.call(staker.address)).should.be.eq.BN(1);
    (await lp.balanceOf.call(accounts[0])).should.be.eq.BN("99" + "9".repeat(18));
    (await staker.getStakedAmount.call(accounts[0])).should.be.eq.BN("1");

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
    await staker.claimRewards(accounts[0]);

    // Confirm balances
    // Actually 2 blocks of rewards due to what's explained above
    (await wind.balanceOf.call(accounts[0])).should.be.eq.BN("902" + TENTH_DECIMAL);
    (await wind.balanceOf.call(staker.address)).should.be.eq.BN("98" + TENTH_DECIMAL);

    await web3.eth.sendTransaction({from: accounts[0], to: accounts[0]});
    // Now that another block has passed...
    (await staker.getRewards.call(accounts[0]))["0"].should.be.eq.BN("1" + TENTH_DECIMAL);

    // Test withdrawals
    staker.withdraw(1);

    // Make sure claimRewards was called
    (await wind.balanceOf.call(accounts[0])).should.be.eq.BN("904" + TENTH_DECIMAL);
    (await wind.balanceOf.call(staker.address)).should.be.eq.BN("96" + TENTH_DECIMAL);

    // Make sure the withdraw occurred
    (await lp.balanceOf.call(staker.address)).should.be.eq.BN(0);
    (await lp.balanceOf.call(accounts[0])).should.be.eq.BN("1000" + TENTH_DECIMAL);
  });

  it("should allow you to deposit more", async () => {
    // TODO
  });

  it("should allow anyone to trigger a claim for anyone", async () => {
    // TODO
  });

  it("should correctly scale the divisor based on the original divisor", async () => {
    // TODO
  });

  it("should update the original divisor if a lower one is now available", async () => {
    // TODO
  });

  it("should allow withdrawing without claiming rewards", async () => {
    // TODO
  });

  it("shouldn't let you withdraw more than you have", async () => {
    // TODO
  });
});
