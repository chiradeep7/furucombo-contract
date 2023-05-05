const chainId = network.config.chainId;

if (chainId == 1 || chainId == 137) {
  // This test supports to run on these chains.
} else {
  return;
}

const {
  balance,
  BN,
  ether,
  constants,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { MAX_UINT256 } = constants;
const { tracker } = balance;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const {
  DAI_TOKEN,
  USDC_TOKEN,
  WRAPPED_NATIVE_TOKEN,
  CBETH_TOKEN,
  COMPOUND_V3_COMET_USDC,
  COMPOUND_V3_COMET_WETH,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  expectEqWithinBps,
  setTokenBalance,
  impersonate,
  injectEther,
  mwei,
} = require('./utils/utils');

const HCompoundV3 = artifacts.require('HCompoundV3');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IComet = artifacts.require('IComet');
const IToken = artifacts.require('IERC20');

contract('Compound V3', function ([_, user, someone]) {
  let id;
  let balanceUser;
  let balanceProxy;

  before(async function () {
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.registry = await Registry.new();
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hCompoundV3 = await HCompoundV3.new(WRAPPED_NATIVE_TOKEN);
    await this.registry.register(
      this.hCompoundV3.address,
      utils.asciiToHex('CompoundV3')
    );

    this.cometUSDC = await IComet.at(COMPOUND_V3_COMET_USDC);
    this.USDC = await IToken.at(USDC_TOKEN);
    this.DAI = await IToken.at(DAI_TOKEN);
    this.wrappedNativeToken = await IToken.at(WRAPPED_NATIVE_TOKEN);

    // Ethereum only
    if (chainId == 1) {
      this.cometWETH = await IComet.at(COMPOUND_V3_COMET_WETH);
      this.cbETH = await IToken.at(CBETH_TOKEN);
    }
  });

  beforeEach(async function () {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
  });

  afterEach(async function () {
    await evmRevert(id);
  });

  describe('Supply', function () {
    describe('Token-base', function () {
      const supplyAmount = ether('10');

      beforeEach(async function () {
        const baseToken = this.USDC;
        const baseTokenBalanceSlotNum = chainId == 1 ? 9 : 0;

        await setTokenBalance(
          baseToken.address,
          this.proxy.address,
          supplyAmount,
          baseTokenBalanceSlotNum
        );

        await this.proxy.updateTokenMock(baseToken.address);
      });

      it('normal', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet.address,
          value
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expectEqWithinBps(value, handlerReturn);

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('max amount', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expectEqWithinBps(value, handlerReturn);

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      // Call repayBase to supply base token directly into user address = no cTokenV3 flow into proxy
      it('by repayBase', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          value
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet.address,
          value
        );

        // Empty proxy base token balance
        await impersonate(this.proxy.address);
        await baseToken.transfer(user, supplyAmount, {
          from: this.proxy.address,
        });

        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_supply: ERC20: transfer amount exceeds balance'
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_supplyBase: zero amount'
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });
    });

    describe('ETH-base', function () {
      // Ethereum only
      if (chainId != 1) {
        return;
      }

      const supplyAmount = ether('1');

      it('normal', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          value
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expectEqWithinBps(value, handlerReturn);

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expectEqWithinBps(value, handlerReturn);

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      // Call repayBaseETH to supply ETH directly into user address = no cTokenV3 flow into proxy
      it('by repayBaseETH', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        const beforeBalance = await baseToken.balanceOf(comet.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify supply
        expectEqWithinBps(await comet.balanceOf(user), value);
        expect(await baseToken.balanceOf(comet.address)).to.be.bignumber.eq(
          beforeBalance.add(value)
        );

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value.div(new BN('2')),
          }),
          '_exec'
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '0_HCompoundV3_supplyBaseETH: zero amount'
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '0_HCompoundV3_supplyBaseETH: wrong cTokenV3'
        );
      });
    });

    describe('Token-collateral', function () {
      const supplyAmount = ether('10');

      beforeEach(async function () {
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;

        await setTokenBalance(
          collateral.address,
          this.proxy.address,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await this.proxy.updateTokenMock(collateral.address);
      });

      it('normal', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify supply
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(value);

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(
            this.proxy.address,
            collateral.address
          )
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('max amount', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          MAX_UINT256
        );

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify supply
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(value);

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(
            this.proxy.address,
            collateral.address
          )
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        // Empty proxy collateral balance
        await impersonate(this.proxy.address);
        await collateral.transfer(user, supplyAmount, {
          from: this.proxy.address,
        });

        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero amount', async function () {
        const collateral = this.wrappedNativeToken;
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_supplyCollateral: zero amount'
        );
      });

      it('should revert: exceed supply cap', async function () {
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;
        const comet = this.cometUSDC;
        const assetInfo = await comet.getAssetInfoByAddress(collateral.address);
        const supplyCap = assetInfo.supplyCap;
        const value = new BN(supplyCap.toString());
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await setTokenBalance(
          collateral.address,
          this.proxy.address,
          value,
          collateralBalanceSlotNum
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: unsupported collateral', async function () {
        const collateral = this.DAI;
        const collateralBalanceSlotNum = 2;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await setTokenBalance(
          collateral.address,
          this.proxy.address,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: supply base token', async function () {
        const collateral = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_supplyCollateral: wrong collateral'
        );
      });
    });

    describe('ETH-collateral', function () {
      const supplyAmount = ether('1');

      it('normal', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          value
        );

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify supply
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(value);

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(
            this.proxy.address,
            collateral.address
          )
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify supply
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(value);

        // Verify proxy balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(
            this.proxy.address,
            collateral.address
          )
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value.div(new BN('2')),
          }),
          '_exec'
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value.div(new BN('2')),
          }),
          '0_HCompoundV3_supplyCollateralETH: zero amount'
        );
      });

      it('should revert: exceed supply cap', async function () {
        const collateral = this.wrappedNativeToken;
        const comet = this.cometUSDC;
        const assetInfo = await comet.getAssetInfoByAddress(collateral.address);
        const supplyCap = assetInfo.supplyCap;
        const value = new BN(supplyCap.toString());
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await injectEther(user, '0x' + value.toString(16));
        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        if (chainId != 1) {
          return;
        }
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '0_HCompoundV3_supplyCollateralETH: wrong cTokenV3'
        );
      });
    });
  });

  describe('Withdraw', function () {
    const supplyAmount = ether('1');

    describe('Token-base', function () {
      // Proxy can withdraw user base token by
      // * holding user cTokenV3
      // * having user access only
      beforeEach(async function () {
        const baseToken = this.USDC;
        const baseTokenBalanceSlotNum = chainId == 1 ? 9 : 0;
        const comet = this.cometUSDC;

        await setTokenBalance(
          baseToken.address,
          user,
          supplyAmount,
          baseTokenBalanceSlotNum
        );

        await baseToken.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(baseToken.address, supplyAmount, {
          from: user,
        });

        // Transfer cTokenV3 to proxy
        const cTokenV3Balance = await comet.balanceOf(user);
        await comet.transfer(this.proxy.address, cTokenV3Balance, {
          from: user,
        });
        await this.proxy.updateTokenMock(comet.address);
      });

      it('normal', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('partial', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(await comet.balanceOf(user)).to.be.bignumber.gte(
          supplyAmount.sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.lte(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.gte(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('by borrow with user allow', async function () {
        const baseToken = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        // Allow proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: by borrow without user allow', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: by borrow with user allow with insufficient cTokenV3 balance', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance.div(new BN('2')), {
          from: this.proxy.address,
        });

        // Allow proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawBase: zero amount'
        );
      });

      it('should revert: exceed base token balance', async function () {
        const value = supplyAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: insufficient cTokenV3', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        // Empty cTokenV3
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });

    describe('ETH-base', function () {
      // Ethereum only
      if (chainId != 1) {
        return;
      }

      beforeEach(async function () {
        const baseToken = this.wrappedNativeToken;
        const baseTokenBalanceSlotNum = 3;
        const comet = this.cometWETH;

        await setTokenBalance(
          baseToken.address,
          user,
          supplyAmount,
          baseTokenBalanceSlotNum
        );

        await baseToken.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(baseToken.address, supplyAmount, {
          from: user,
        });

        // Transfer cTokenV3 to proxy
        const cTokenV3Balance = await comet.balanceOf(user);
        await comet.transfer(this.proxy.address, cTokenV3Balance, {
          from: user,
        });
        await this.proxy.updateTokenMock(comet.address);
      });

      it('normal', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('partial', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        expect(await comet.balanceOf(user)).to.be.bignumber.gte(
          supplyAmount.sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.lte(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.gte(value);
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('by borrowETH with user allow', async function () {
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        // Allow proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: by borrowETH without user allow ', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: by borrowETH without user allow with insufficient cTokenV3 balance', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        // Transfer cTokenV3 back to user
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance.div(new BN('2')), {
          from: this.proxy.address,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawBaseETH: zero amount'
        );
      });

      it('should revert: exceed base token balance', async function () {
        const value = supplyAmount.mul(new BN('2'));
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawBaseETH: wrong cTokenV3'
        );
      });

      it('should revert: insufficient cTokenV3', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        // Empty cTokenV3
        await impersonate(this.proxy.address);
        const cTokenV3Balance = await comet.balanceOf(this.proxy.address);
        await comet.transfer(user, cTokenV3Balance, {
          from: this.proxy.address,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });

    describe('Token-collateral', function () {
      beforeEach(async function () {
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;
        const comet = this.cometUSDC;

        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        // Allow proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });
      });

      it('normal', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('partial', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount.sub(value));
        profileGas(receipt);
      });

      it('withdraw partial when collateralized', async function () {
        const collateral = this.wrappedNativeToken;
        const baseToken = this.USDC;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        // Supply Extra Token
        const collateralBalanceSlotNum = 3;
        const extraSupplyAmount = ether('2000');

        await setTokenBalance(
          collateral.address,
          user,
          extraSupplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, extraSupplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, extraSupplyAmount, {
          from: user,
        });

        // Borrow token
        const borrowAmount = mwei('1000');
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount.add(extraSupplyAmount).sub(value));
        profileGas(receipt);
      });

      it('should revert: zero amount', async function () {
        const collateral = this.wrappedNativeToken;
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawCollateral: zero amount'
        );
      });

      it('should revert: exceed collateral balance', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: zero collateral address', async function () {
        const collateral = constants.ZERO_ADDRESS;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: unsupported collateral', async function () {
        const collateral = this.DAI;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: withdraw base token', async function () {
        const collateral = this.USDC;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawCollateral: wrong collateral'
        );
      });

      it('should revert: withdraw all when collateralized', async function () {
        const collateral = this.wrappedNativeToken;

        var value = supplyAmount;
        const comet = this.cometUSDC;

        // Polygon only due to cheap WMATIC price
        if (chainId == 137) {
          const collateralBalanceSlotNum = 3;
          const extraSupplyAmount = ether('2000');

          await setTokenBalance(
            collateral.address,
            user,
            extraSupplyAmount,
            collateralBalanceSlotNum
          );

          await collateral.approve(comet.address, extraSupplyAmount, {
            from: user,
          });

          await comet.supply(collateral.address, extraSupplyAmount, {
            from: user,
          });
          value = value.add(extraSupplyAmount);
        }

        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        // Borrow token
        const borrowAmount = mwei('1000');
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: disallow', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateral(address,address,uint256)',
          comet.address,
          collateral.address,
          value
        );

        // Disallow proxy to move funds
        await comet.allow(this.proxy.address, false, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });

    describe('ETH-collateral', function () {
      // Ethereum only
      if (chainId != 1) {
        return;
      }

      beforeEach(async function () {
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;
        const comet = this.cometUSDC;

        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        // Allow proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });
      });

      it('normal', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('partial', async function () {
        const collateral = this.wrappedNativeToken;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount.sub(value));
        profileGas(receipt);
      });

      it('withdraw partial when collateralized', async function () {
        const collateral = this.wrappedNativeToken;
        const baseToken = this.USDC;
        const value = supplyAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        // Borrow token
        const borrowAmount = mwei('100');
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await collateral.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await collateral.balanceOf(user)).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount.sub(value));
        profileGas(receipt);
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawCollateralETH: zero amount'
        );
      });

      it('should revert: exceed collateral balance', async function () {
        const value = supplyAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_withdrawCollateralETH: wrong cTokenV3'
        );
      });

      it('should revert: withdraw all when collateralized', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        // Borrow token
        const borrowAmount = mwei('1000'); // 50%
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: disallow', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawCollateralETH(address,uint256)',
          comet.address,
          value
        );

        // Disallow proxy to move funds
        await comet.allow(this.proxy.address, false, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });
  });

  describe('Borrow', function () {
    const supplyAmount = ether('2000');

    describe('Token-base', function () {
      beforeEach(async function () {
        // Supply token comet
        const comet = this.cometUSDC;
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;

        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        // Permit proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });
      });

      it('normal', async function () {
        const collateral = this.wrappedNativeToken;
        const baseToken = this.USDC;
        const value = mwei('1000'); // 50%
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);
        profileGas(receipt);
      });

      it('withdraw and borrow', async function () {
        const collateral = this.wrappedNativeToken;
        const baseToken = this.USDC;
        const value = supplyAmount.add(mwei('1000')); // 50%
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        // Supply base token
        const baseTokenBalanceSlotNum = chainId == 1 ? 9 : 0;
        await setTokenBalance(
          baseToken.address,
          user,
          supplyAmount,
          baseTokenBalanceSlotNum
        );

        await baseToken.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(baseToken.address, supplyAmount, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);
        expect(await comet.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_borrow: zero amount'
        );
      });

      it('should revert: less than borrow min', async function () {
        const comet = this.cometUSDC;
        const value = (await comet.baseBorrowMin()).sub(new BN('1'));
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: exceed collateralized value', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode('borrow(address,uint256)', comet, value);

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: disallow', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrow(address,uint256)',
          comet.address,
          value
        );

        // Disallow proxy to move funds
        await comet.allow(this.proxy.address, false, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: by withdrawBase', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBase(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });

    describe('ETH-base', function () {
      // Ethereum only
      if (chainId != 1) {
        return;
      }
      beforeEach(async function () {
        // Supply WETH comet
        const collateral = this.cbETH;
        const collateralBalanceSlotNum = 9;
        const comet = this.cometWETH;

        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        // Permit proxy to move funds
        await comet.allow(this.proxy.address, true, {
          from: user,
        });
      });

      it('normal', async function () {
        const collateral = this.cbETH;
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount.div(new BN('2')); // 50%
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);
        profileGas(receipt);
      });

      it('withdraw and borrow', async function () {
        const collateral = this.cbETH;
        const baseToken = this.wrappedNativeToken;
        const value = supplyAmount.add(supplyAmount.div(new BN('2'))); // 50%
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );
        // Supply base token
        const baseTokenBalanceSlotNum = 3;
        await setTokenBalance(
          baseToken.address,
          user,
          supplyAmount,
          baseTokenBalanceSlotNum
        );

        await baseToken.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(baseToken.address, supplyAmount, {
          from: user,
        });

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);
        expect(await comet.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_borrowETH: zero amount'
        );
      });

      it('should revert: less than borrow min', async function () {
        const comet = this.cometWETH;
        const value = (await comet.baseBorrowMin()).sub(new BN('1'));
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: exceed collateralized value', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: zero comet address', async function () {
        const value = supplyAmount;
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        const value = supplyAmount;
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_borrowETH: wrong cTokenV3'
        );
      });

      it('should revert: disallow', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'borrowETH(address,uint256)',
          comet.address,
          value
        );

        // Disallow proxy to move funds
        await comet.allow(this.proxy.address, false, {
          from: user,
        });

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });

      it('should revert: by withdrawBaseETH', async function () {
        const value = supplyAmount;
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'withdrawBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          })
        );
      });
    });
  });

  describe('Repay', function () {
    const supplyAmount = ether('2000');

    describe('Token-base', function () {
      const initAmount = mwei('2000');
      const borrowAmount = mwei('1000');

      beforeEach(async function () {
        // Supply token comet
        const collateral = this.wrappedNativeToken;
        const collateralBalanceSlotNum = 3;
        const baseToken = this.USDC;
        const baseTokenBalanceSlotNum = chainId == 1 ? 9 : 0;
        const comet = this.cometUSDC;

        // Set user collateral balance
        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        // Set user baseToken balance
        await setTokenBalance(
          baseToken.address,
          user,
          initAmount,
          baseTokenBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);

        // Borrow Token
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          initAmount.add(borrowAmount)
        );
      });

      it('repay and supply', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          value
        );

        // Transfer repay token to proxy
        await baseToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(baseToken.address);

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          initAmount.add(borrowAmount).sub(value)
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      it('partial', async function () {
        const value = borrowAmount.div(new BN('2'));
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          value
        );

        // Transfer base token to proxy to repay
        await baseToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(baseToken.address);

        await balanceUser.get();
        const debtBefore = await comet.borrowBalanceOf(user);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify repay
        const debtAfter = await comet.borrowBalanceOf(user);
        expectEqWithinBps(debtBefore.sub(debtAfter), value);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          initAmount.add(borrowAmount).sub(value)
        );
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(await comet.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('max amount', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        // Transfer repay token to proxy
        await baseToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(baseToken.address);

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          initAmount.add(borrowAmount).sub(value)
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      // Call supplyBase to get cTokenV3 and repay base token when proxy transfer cTokenV3 back to user
      it('by supplyBase', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBase(address,uint256)',
          comet.address,
          value
        );

        // Transfer repay token to proxy
        await baseToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(baseToken.address);

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.zero;
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          initAmount.add(borrowAmount).sub(value)
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          value
        );

        // Transfer repay token to proxy
        await baseToken.transfer(this.proxy.address, value.div(new BN('2')), {
          from: user,
        });
        await this.proxy.updateTokenMock(baseToken.address);

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_supply: ERC20: transfer amount exceeds balance'
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '0_HCompoundV3_repayBase: zero amount'
        );
      });

      it('should revert: zero comet address', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = constants.ZERO_ADDRESS;
        const baseToken = this.USDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBase(address,uint256)',
          comet,
          value
        );

        // Transfer repay token to proxy
        await baseToken.transfer(this.proxy.address, value, {
          from: user,
        });
        await this.proxy.updateTokenMock(baseToken.address);

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: ether('0.1'),
          }),
          '_exec'
        );
      });
    });

    describe('ETH-base', function () {
      // Ethereum only
      if (chainId != 1) {
        return;
      }
      const borrowAmount = supplyAmount.div(new BN('2'));

      beforeEach(async function () {
        // Supply WETH comet
        const collateral = this.cbETH;
        const collateralBalanceSlotNum = 9;
        const baseToken = this.wrappedNativeToken;
        const comet = this.cometWETH;

        // Set user collateral balance
        await setTokenBalance(
          collateral.address,
          user,
          supplyAmount,
          collateralBalanceSlotNum
        );

        await collateral.approve(comet.address, supplyAmount, {
          from: user,
        });

        await comet.supply(collateral.address, supplyAmount, {
          from: user,
        });

        expect(
          await comet.collateralBalanceOf(user, collateral.address)
        ).to.be.bignumber.eq(supplyAmount);

        // Borrow base token
        await comet.withdraw(baseToken.address, borrowAmount, {
          from: user,
        });

        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          borrowAmount
        );
      });

      it('repay and supply', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometWETH;
        const baseToken = this.wrappedNativeToken;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        // Set user ETH balance
        await injectEther(user, '0x' + value.toString(16));

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          borrowAmount
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      it('partial', async function () {
        const value = borrowAmount.div(new BN('2'));
        const comet = this.cometWETH;
        const baseToken = this.wrappedNativeToken;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        // Set user ETH balance
        await injectEther(user, '0x' + value.toString(16));

        await balanceUser.get();
        const debtBefore = await comet.borrowBalanceOf(user);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify repay
        const debtAfter = await comet.borrowBalanceOf(user);
        expectEqWithinBps(debtBefore.sub(debtAfter), value);

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          borrowAmount
        );
        expect(await comet.balanceOf(user)).to.be.bignumber.zero;
        profileGas(receipt);
      });

      it('max amount', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometWETH;
        const baseToken = this.wrappedNativeToken;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          MAX_UINT256
        );

        // Set user ETH balance
        await injectEther(user, '0x' + value.toString(16));

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          borrowAmount
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      // Call supplyBaseETH to get cTokenV3 and repay base token when proxy transfer cTokenV3 back to user
      it('by supplyBaseETH', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometWETH;
        const baseToken = this.wrappedNativeToken;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'supplyBaseETH(address,uint256)',
          comet.address,
          value
        );

        // Set user ETH balance
        await injectEther(user, '0x' + value.toString(16));

        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify repay
        expect(await comet.borrowBalanceOf(user)).to.be.bignumber.zero;

        // Verify proxy balance
        expect(await balanceProxy.delta()).to.be.bignumber.zero;
        expect(
          await baseToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(await comet.balanceOf(this.proxy.address)).to.be.bignumber.zero;

        // Verify user balance
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        expect(await baseToken.balanceOf(user)).to.be.bignumber.eq(
          borrowAmount
        );
        expectEqWithinBps(await comet.balanceOf(user), value.sub(borrowAmount));
        profileGas(receipt);
      });

      it('should revert: insufficient amount', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        // Set user ETH balance
        await injectEther(user, '0x' + value.div(new BN('2')).toString(16));

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          "Returned error: sender doesn't have enough funds to send tx. The max upfront cost is: 2000000000000000000000 and the sender's account only has: 1000000000000000000000"
        );
      });

      it('should revert: zero amount', async function () {
        const value = ether('0');
        const comet = this.cometWETH;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '0_HCompoundV3_repayBaseETH: zero amount'
        );
      });

      it('should revert: zero comet address', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = constants.ZERO_ADDRESS;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '_exec'
        );
      });

      it('should revert: wrong comet address', async function () {
        const value = borrowAmount.mul(new BN('2'));
        const comet = this.cometUSDC;
        const to = this.hCompoundV3.address;
        const data = abi.simpleEncode(
          'repayBaseETH(address,uint256)',
          comet.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, {
            from: user,
            value: value,
          }),
          '0_HCompoundV3_repayBaseETH: wrong cTokenV3'
        );
      });
    });
  });
});