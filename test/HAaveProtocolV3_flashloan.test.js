const chainId = network.config.chainId;

if (
  chainId == 1 ||
  chainId == 10 ||
  chainId == 137 ||
  // chainId == 1088 ||
  chainId == 42161 ||
  chainId == 43114
) {
  // This test supports to run on these chains.
} else {
  return;
}

const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { ZERO_BYTES32 } = constants;
const abi = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = web3.utils;

const { expect } = require('chai');

const {
  WRAPPED_NATIVE_TOKEN,
  DAI_TOKEN,
  WETH_TOKEN,
  AAVEPROTOCOL_V3_PROVIDER,
  ADAI_V3_DEBT_STABLE,
  ADAI_V3_DEBT_VARIABLE,
  AAVE_RATEMODE,
  USDC_TOKEN,
  AUSDC_V3_TOKEN,
} = require('./utils/constants');

const {
  mwei,
  evmRevert,
  evmSnapshot,
  getBalanceSlotNum,
  setTokenBalance,
  expectEqWithinBps,
} = require('./utils/utils');

const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const HAaveV3 = artifacts.require('HAaveProtocolV3');
const HMock = artifacts.require('HMock');
const Faucet = artifacts.require('Faucet');
const SimpleToken = artifacts.require('SimpleToken');
const IToken = artifacts.require('IERC20');
const IPool = artifacts.require('contracts/handlers/aaveV3/IPool.sol:IPool');
const IProvider = artifacts.require('IPoolAddressesProvider');
const IVariableDebtToken = artifacts.require('IVariableDebtTokenV3');
const IStableDebtToken = artifacts.require('IStableDebtTokenV3');

contract('AaveV3 flashloan', function ([_, user, someone]) {
  const tokenASymbol = 'DAI';
  const tokenBSymbol = 'USDC';

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
    // Register aave v3 handler
    this.hAaveV3 = await HAaveV3.new(
      WRAPPED_NATIVE_TOKEN,
      AAVEPROTOCOL_V3_PROVIDER
    );
    await this.registry.register(
      this.hAaveV3.address,
      utils.asciiToHex('Aave ProtocolV3')
    );
    // Register mock handler
    this.hMock = await HMock.new();
    await this.registry.register(this.hMock.address, utils.asciiToHex('Mock'));

    // Register aave v3 pool for flashloan
    this.provider = await IProvider.at(AAVEPROTOCOL_V3_PROVIDER);
    const poolAddress = await this.provider.getPool();
    this.pool = await IPool.at(poolAddress);
    await this.registry.registerCaller(poolAddress, this.hAaveV3.address);

    this.faucet = await Faucet.new();
    this.tokenA = await IToken.at(DAI_TOKEN);
    this.tokenB = await IToken.at(USDC_TOKEN);
    this.aTokenB = await IToken.at(AUSDC_V3_TOKEN);
    this.stableDebtTokenA = await IStableDebtToken.at(ADAI_V3_DEBT_STABLE);
    this.variableDebtTokenA = await IVariableDebtToken.at(
      ADAI_V3_DEBT_VARIABLE
    );
    this.mockToken = await SimpleToken.new();
  });

  beforeEach(async function () {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
  });

  afterEach(async function () {
    await evmRevert(id);
  });

  describe('Pool as handler', function () {
    it('Will success if pool is registered as handler', async function () {
      await this.registry.register(this.pool.address, this.hAaveV3.address);
      const to = this.pool.address;
      const data = abi.simpleEncode(
        'initialize(address,bytes)',
        this.registry.address,
        ''
      );
      await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
    });

    it('Will revert if pool is registered as caller only', async function () {
      const to = this.pool.address;
      const data = abi.simpleEncode(
        'initialize(address,bytes)',
        this.registry.address,
        ''
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'Invalid handler'
      );
    });
  });

  describe('Normal', function () {
    beforeEach(async function () {
      await sendToken(
        tokenASymbol,
        this.tokenA,
        this.faucet.address,
        ether('100')
      );
      await sendToken(
        tokenBSymbol,
        this.tokenB,
        this.faucet.address,
        mwei('100')
      );

      tokenAUser = await this.tokenA.balanceOf(user);
      tokenBUser = await this.tokenB.balanceOf(user);

      const supplyAmount = mwei('500');
      await sendToken(tokenBSymbol, this.tokenB, user, supplyAmount);
      await this.tokenB.approve(this.pool.address, supplyAmount, {
        from: user,
      });
      await this.pool.supply(this.tokenB.address, supplyAmount, user, 0, {
        from: user,
      });
      // For 1 wei tolerance
      expect(await this.aTokenB.balanceOf(user)).to.be.bignumber.gte(
        new BN(supplyAmount).sub(new BN('1'))
      );
    });

    it('Single asset with no debt', async function () {
      // Get flashloan params
      const value = ether('0.1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      // Get flashloan handler data
      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.NODEBT], // modes
        params
      );

      // Exec proxy
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Verify
      const fee = _getFlashloanFee(value);
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(value).sub(fee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('single asset with stable rate by borrowing from itself', async function () {
      if (
        chainId == 1 ||
        chainId == 10 ||
        chainId == 137 ||
        chainId == 1088 ||
        chainId == 42161 ||
        chainId == 43114
      ) {
        // Ethereum and Metis does not support borrow in stable mode
        // Optimism, Polygon, Arbitrum, Avalaunche disable stable mode in 2023/11
        return;
      }
      // Get flashloan params
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      // Get flashloan handler data
      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.STABLE], // modes
        params
      );

      // Approve delegation to proxy get the debt
      await this.stableDebtTokenA.approveDelegation(this.proxy.address, value, {
        from: user,
      });

      // Exec proxy
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Verify
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(value).add(value)
      );
      expect(await this.stableDebtTokenA.balanceOf(user)).to.be.bignumber.eq(
        value
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('single asset with variable rate by borrowing from itself', async function () {
      // Get flashloan params
      const value = ether('0.1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      // Get flashloan handler data
      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );

      // approve delegation to proxy get the debt
      await this.variableDebtTokenA.approveDelegation(
        this.proxy.address,
        value,
        {
          from: user,
        }
      );

      // Exec proxy
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Verify
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(value).add(value)
      );
      expectEqWithinBps(
        await this.variableDebtTokenA.balanceOf(user),
        value,
        1
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('multiple assets with no debt', async function () {
      // Get flashloan params
      const tokenAValue = ether('0.1');
      const tokenBValue = mwei('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [tokenAValue, tokenBValue]
      );

      // Get flashloan handler data
      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params
      );

      // Exec proxy
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      const tokenAFee = _getFlashloanFee(tokenAValue);
      const tokenBFee = _getFlashloanFee(tokenBValue);
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(tokenAValue).sub(tokenAFee)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUser.add(tokenBValue).sub(tokenBFee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('should revert: assets and amount do not match', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HAaveProtocolV3_flashLoan: assets and amounts do not match'
      );
    });

    it('should revert: assets and modes do not match', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HAaveProtocolV3_flashLoan: assets and modes do not match'
      );
    });

    it('should revert: not approveDelegation to proxy', async function () {
      const value = ether('0.1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HAaveProtocolV3_flashLoan: Unspecified'
      );
    });

    it('should revert: collateral same as borrowing currency', async function () {
      const value = mwei('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenB.address],
        [value]
      );

      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.tokenB.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'AaveProtocolV3_flashLoan: Unspecified'
      );
    });

    it('should revert: unsupported token', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hAaveV3.address;
      const data = _getFlashloanCubeData(
        [this.mockToken.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.STABLE], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HAaveProtocolV3_flashLoan: 27' // AAVEV3 Error Code: RESERVE_INACTIVE
      );
    });
  });

  describe('Multiple Cubes', function () {
    beforeEach(async function () {
      if (chainId == 1088) {
        const tokenASymbol_ = 'WETH';
        this.tokenA = await IToken.at(WETH_TOKEN);
        await sendToken(
          tokenASymbol_,
          this.tokenA,
          this.faucet.address,
          ether('100')
        );
      } else {
        await sendToken(
          tokenASymbol,
          this.tokenA,
          this.faucet.address,
          ether('100')
        );
      }

      await sendToken(
        tokenBSymbol,
        this.tokenB,
        this.faucet.address,
        mwei('100')
      );

      tokenAUser = await this.tokenA.balanceOf(user);
      tokenBUser = await this.tokenB.balanceOf(user);
    });

    it('sequential', async function () {
      const tokenAValue = ether('0.1');
      const tokenBValue = mwei('1');
      // Setup 1st flashloan cube
      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [tokenAValue, tokenBValue]
      );

      const to1 = this.hAaveV3.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Setup 2nd flashloan cube
      const params2 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [tokenAValue, tokenBValue]
      );

      const to2 = this.hAaveV3.address;
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      // Execute proxy batchExec
      const to = [to1, to2];
      const config = [ZERO_BYTES32, ZERO_BYTES32];
      const data = [data1, data2];
      const receipt = await this.proxy.batchExec(to, config, data, [], {
        from: user,
        value: ether('0.1'),
      });

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      const tokenAFee = _getFlashloanFee(tokenAValue.mul(new BN('2')));
      const tokenBFee = _getFlashloanFee(tokenBValue.mul(new BN('2')));
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(tokenAValue.add(tokenAValue)).sub(tokenAFee)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUser.add(tokenBValue.add(tokenBValue)).sub(tokenBFee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('nested', async function () {
      // Get flashloan params
      const tokenAValue = ether('0.1');
      const tokenBValue = mwei('1');

      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [tokenAValue, tokenBValue]
      );

      // Get 1st flashloan cube data
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Encode 1st flashloan cube data as flashloan param
      const params2 = web3.eth.abi.encodeParameters(
        ['address[]', 'bytes32[]', 'bytes[]'],
        [[this.hAaveV3.address], [ZERO_BYTES32], [data1]]
      );

      // Get 2nd flashloan cube data
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      // Execute proxy batchExec
      const to = [this.hAaveV3.address];
      const config = [ZERO_BYTES32];
      const data = [data2];
      const receipt = await this.proxy.batchExec(to, config, data, [], {
        from: user,
        value: ether('0.1'),
      });

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      const tokenAFee = _getFlashloanFee(tokenAValue.mul(new BN('2')));
      const tokenBFee = _getFlashloanFee(tokenBValue.mul(new BN('2')));
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(tokenAValue).sub(tokenAFee)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUser.add(tokenBValue).sub(tokenBFee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });
  });

  describe('supply', function () {
    beforeEach(async function () {
      tokenAUser = await this.tokenA.balanceOf(user);
      tokenBUser = await this.tokenB.balanceOf(user);
      await sendToken(
        tokenASymbol,
        this.tokenA,
        this.faucet.address,
        ether('100')
      );
      await sendToken(
        tokenBSymbol,
        this.tokenB,
        this.faucet.address,
        mwei('100')
      );
    });

    it('supply aaveV3 after flashloan', async function () {
      // Get flashloan params
      const tokenAValue = ether('0.1');
      const tokenBValue = mwei('1');
      const supplyValue = mwei('0.5');
      const testTo1 = [this.hMock.address, this.hAaveV3.address];
      const testConfig1 = [ZERO_BYTES32, ZERO_BYTES32];
      const testData1 = [
        '0x' +
          abi
            .simpleEncode(
              'drainTokens(address[],address[],uint256[])',
              [this.faucet.address, this.faucet.address],
              [this.tokenA.address, this.tokenB.address],
              [tokenAValue, tokenBValue]
            )
            .toString('hex'),
        abi.simpleEncode(
          'supply(address,uint256)',
          this.tokenB.address,
          supplyValue
        ),
      ];

      const params1 = web3.eth.abi.encodeParameters(
        ['address[]', 'bytes32[]', 'bytes[]'],
        [testTo1, testConfig1, testData1]
      );

      // Get flashloan cube data
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [tokenAValue, tokenBValue], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Execute proxy batchExec
      const to = [this.hAaveV3.address];
      const config = [ZERO_BYTES32];
      const data = [data1];
      const receipt = await this.proxy.batchExec(to, config, data, [], {
        from: user,
        value: ether('0.1'),
      });

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      const tokenAFee = _getFlashloanFee(tokenAValue);
      const tokenBFfee = _getFlashloanFee(tokenBValue);
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUser.add(tokenAValue).sub(tokenAFee)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUser.add(tokenBValue.sub(supplyValue).sub(tokenBFfee))
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });
  });

  describe('Non-proxy', function () {
    beforeEach(async function () {
      await sendToken(
        tokenASymbol,
        this.tokenA,
        this.faucet.address,
        ether('100')
      );
    });

    it('should revert: not initiated by the proxy', async function () {
      const value = ether('0.1');
      // Setup 1st flashloan cube
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      await expectRevert(
        this.pool.flashLoan(
          this.proxy.address,
          [this.tokenA.address],
          [value],
          [AAVE_RATEMODE.NODEBT],
          someone,
          params,
          0,
          { from: someone }
        ),
        'Sender is not initialized'
      );
    });
  });

  describe('executeOperation', function () {
    it('should revert: non-pool call executeOperation() directly', async function () {
      const data = abi.simpleEncode(
        'executeOperation(address[],uint256[],uint256[],address,bytes)',
        [],
        [],
        [],
        this.proxy.address,
        util.toBuffer(0)
      );
      const to = this.hAaveV3.address;
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
        }),
        'HAaveProtocolV3_executeOperation: invalid caller'
      );
    });
  });

  async function sendToken(symbol, token, to, amount) {
    const baseTokenBalanceSlotNum = await getBalanceSlotNum(symbol, chainId);
    await setTokenBalance(token.address, to, amount, baseTokenBalanceSlotNum);
  }
});

function _getFlashloanParams(tos, configs, faucets, tokens, amounts) {
  const data = [
    '0x' +
      abi
        .simpleEncode(
          'drainTokens(address[],address[],uint256[])',
          faucets,
          tokens,
          amounts
        )
        .toString('hex'),
  ];

  const params = web3.eth.abi.encodeParameters(
    ['address[]', 'bytes32[]', 'bytes[]'],
    [tos, configs, data]
  );
  return params;
}

function _getFlashloanCubeData(assets, amounts, modes, params) {
  const data = abi.simpleEncode(
    'flashLoan(address[],uint256[],uint256[],bytes)',
    assets,
    amounts,
    modes,
    util.toBuffer(params)
  );
  return data;
}

function _getFlashloanFee(value) {
  return value.mul(new BN('5')).div(new BN('10000'));
}const chainId = network.config.chainId;
if (
  chainId == 1 ||
  chainId == 10 ||
  chainId == 137 ||
  // chainId == 250 || // Skip due to frequent error reports from the ParaSwap API on Fantom
  chainId == 42161 ||
  chainId == 43114
) {
  // This test supports to run on these chains.
} else {
  return;
}

const {
  balance,
  BN,
  ether,
  expectRevert,
  constants,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const utils = web3.utils;
const { expect, assert } = require('chai');
const {
  DAI_TOKEN,
  USDC_TOKEN,
  NATIVE_TOKEN_ADDRESS,
  NATIVE_TOKEN_DECIMAL,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  getHandlerReturn,
  getCallData,
  getTokenProvider,
  callExternalApi,
  mwei,
} = require('./utils/utils');
const queryString = require('query-string');

const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const HParaSwapV5 = artifacts.require('HParaSwapV5');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');

const URL_PARASWAP = 'https://apiv5.paraswap.io/';
const EXCLUDE_DEXS = 'ParaSwapPool,ParaSwapLimitOrders';
const IGNORE_CHECKS_PARAM = 'ignoreChecks=true';
const URL_PARASWAP_PRICE = URL_PARASWAP + 'prices';
const URL_PARASWAP_TRANSACTION =
  URL_PARASWAP +
  'transactions/' +
  network.config.chainId +
  '?' +
  IGNORE_CHECKS_PARAM;

const PARTNER_ADDRESS = '0x5cF829F5A8941f4CD2dD104e39486a69611CD013';

async function getPriceData(
  srcToken,
  srcDecimals,
  destToken,
  destDecimals,
  amount,
  route = '',
  excludeDirectContractMethods = ''
) {
  const priceReq = queryString.stringifyUrl({
    url: URL_PARASWAP_PRICE,
    query: {
      srcToken: srcToken,
      srcDecimals: srcDecimals,
      destToken: destToken,
      destDecimals: destDecimals,
      amount: amount,
      network: network.config.chainId,
      excludeDEXS: EXCLUDE_DEXS,
      route: route,
      partner: PARTNER_ADDRESS,
      excludeDirectContractMethods: excludeDirectContractMethods,
    },
  });

  // Call Paraswap price API
  const priceResponse = await callExternalApi(priceReq);
  let priceData = priceResponse.json();
  if (priceResponse.ok === false) {
    assert.fail('ParaSwap price api fail:' + priceData.error);
  }
  return priceData;
}

async function getTransactionData(
  priceData,
  slippageInBps,
  userAddress,
  txOrigin
) {
  const body = {
    srcToken: priceData.priceRoute.srcToken,
    srcDecimals: priceData.priceRoute.srcDecimals,
    destToken: priceData.priceRoute.destToken,
    destDecimals: priceData.priceRoute.destDecimals,
    srcAmount: priceData.priceRoute.srcAmount,
    slippage: slippageInBps,
    userAddress: userAddress,
    txOrigin: txOrigin,
    priceRoute: priceData.priceRoute,
    partner: PARTNER_ADDRESS,
  };

  const txResp = await callExternalApi(URL_PARASWAP_TRANSACTION, 'post', body);
  const txData = await txResp.json();
  if (txResp.ok === false) {
    assert.fail('ParaSwap transaction api fail:' + txData.error);
  }
  return txData;
}

contract('ParaSwapV5', function ([_, user, user2]) {
  let id;
  let initialEvmId;

  before(async function () {
    initialEvmId = await evmSnapshot();

    this.registry = await Registry.new();
    this.hParaSwap = await HParaSwapV5.new();
    await this.registry.register(
      this.hParaSwap.address,
      utils.asciiToHex('ParaSwapV5')
    );
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
  });

  beforeEach(async function () {
    id = await evmSnapshot();
  });

  afterEach(async function () {
    await evmRevert(id);
  });

  after(async function () {
    await evmRevert(initialEvmId);
  });

  describe('Ether to Token', function () {
    const tokenAddress = DAI_TOKEN;
    const tokenDecimal = 18;
    const slippageInBps = 100; // 1%
    const wrongTokenAddress = USDC_TOKEN;
    let userBalance, proxyBalance, userTokenBalance;

    before(async function () {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function () {
      userBalance = await tracker(user);
      proxyBalance = await tracker(this.proxy.address);
      userTokenBalance = await this.token.balanceOf.call(user);
    });

    describe('Swap', function () {
      it('normal', async function () {
        const amount = ether('0.1');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          tokenAddress,
          tokenDecimal,
          amount
        );

        const expectReceivedAmount = priceData.priceRoute.destAmount;

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          NATIVE_TOKEN_ADDRESS,
          amount,
          tokenAddress,
          txData.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, callData, {
          from: user,
          value: amount,
        });

        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        const userTokenBalanceAfter = await this.token.balanceOf.call(user);

        // Verify user token balance
        expect(handlerReturn).to.be.bignumber.eq(
          userTokenBalanceAfter.sub(userTokenBalance)
        );
        expect(userTokenBalanceAfter.sub(userTokenBalance)).to.be.bignumber.gt(
          mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
        );

        // Proxy should not have remaining token
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await proxyBalance.get()).to.be.bignumber.zero;
        expect(await userBalance.delta()).to.be.bignumber.eq(
          ether('0').sub(amount)
        );
      });

      it('msg.value greater than input ether amount', async function () {
        const amount = ether('0.1');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          tokenAddress,
          tokenDecimal,
          amount
        );

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          NATIVE_TOKEN_ADDRESS,
          amount,
          tokenAddress,
          txData.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, callData, {
          from: user,
          value: amount.add(ether('1')),
        });

        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        const userTokenBalanceAfter = await this.token.balanceOf.call(user);

        // Verify user balance
        expect(handlerReturn).to.be.bignumber.eq(
          userTokenBalanceAfter.sub(userTokenBalance)
        );

        // Proxy should not have remaining token
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await proxyBalance.get()).to.be.bignumber.zero;
        expect(await userBalance.delta()).to.be.bignumber.eq(
          ether('0').sub(amount)
        );
      });

      it('should revert: wrong destination token(erc20)', async function () {
        const amount = ether('0.1');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          tokenAddress,
          tokenDecimal,
          amount
        );

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          NATIVE_TOKEN_ADDRESS,
          amount,
          wrongTokenAddress,
          txData.data,
        ]);

        // Execute
        await expectRevert(
          this.proxy.execMock(to, callData, {
            from: user,
            value: amount,
          }),
          'HParaSwapV5_swap: Invalid output token amount'
        );
      });

      it('should revert: msg.value less than api amount', async function () {
        const amount = ether('0.1');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          tokenAddress,
          tokenDecimal,
          amount
        );

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          NATIVE_TOKEN_ADDRESS,
          amount.sub(ether('0.05')),
          tokenAddress,
          txData.data,
        ]);

        // Execute
        await expectRevert(
          this.proxy.execMock(to, callData, {
            from: user,
            value: amount.sub(ether('0.05')),
          }),
          'HParaSwapV5__paraswapCall:'
        );
      });
    });
  }); // describe('ether to token') end

  describe('token to ether', function () {
    const tokenAddress = USDC_TOKEN;
    const tokenDecimal = 6;
    const slippageInBps = 100; // 1%
    let providerAddress;
    let userBalance, proxyBalance;

    before(async function () {
      providerAddress = await getTokenProvider(tokenAddress);
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function () {
      userBalance = await tracker(user);
      proxyBalance = await tracker(this.proxy.address);
    });

    it('normal', async function () {
      const amount = mwei('50');
      const to = this.hParaSwap.address;

      // Call Paraswap price API
      const priceData = await getPriceData(
        tokenAddress,
        tokenDecimal,
        NATIVE_TOKEN_ADDRESS,
        NATIVE_TOKEN_DECIMAL,
        amount
      );

      const expectReceivedAmount = priceData.priceRoute.destAmount;

      // Call Paraswap transaction API
      const txData = await getTransactionData(
        priceData,
        slippageInBps,
        this.proxy.address,
        user
      );

      // Prepare handler data
      const callData = getCallData(HParaSwapV5, 'swap', [
        tokenAddress,
        amount,
        NATIVE_TOKEN_ADDRESS,
        txData.data,
      ]);

      // Transfer token to proxy
      await this.token.transfer(this.proxy.address, amount, {
        from: providerAddress,
      });

      // Execute
      const receipt = await this.proxy.execMock(to, callData, {
        from: user,
      });

      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );

      // Verify user balance
      const userBalanceDelta = await userBalance.delta();
      expect(handlerReturn).to.be.bignumber.eq(userBalanceDelta);

      // Proxy should not have remaining token
      expect(
        await this.token.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify ether balance
      expect(await proxyBalance.get()).to.be.bignumber.zero;
      expect(userBalanceDelta).to.be.bignumber.gt(
        mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
      );
    });

    it('should revert: not enough srcToken', async function () {
      const amount = mwei('5000');
      const to = this.hParaSwap.address;

      // Call Paraswap price API
      const priceData = await getPriceData(
        tokenAddress,
        tokenDecimal,
        NATIVE_TOKEN_ADDRESS,
        NATIVE_TOKEN_DECIMAL,
        amount
      );

      // Call Paraswap transaction API
      const txData = await getTransactionData(
        priceData,
        slippageInBps,
        this.proxy.address,
        user
      );

      // Prepare handler data
      const callData = getCallData(HParaSwapV5, 'swap', [
        tokenAddress,
        amount,
        NATIVE_TOKEN_ADDRESS,
        txData.data,
      ]);

      // Transfer token to proxy
      await this.token.transfer(this.proxy.address, amount.sub(mwei('1')), {
        from: providerAddress,
      });

      // Execute
      await expectRevert(
        this.proxy.execMock(to, callData, {
          from: user,
        }),
        'HParaSwapV5__paraswapCall'
      );
    });
  }); // describe('token to ether') end

  describe('token to token', function () {
    const token1Address = USDC_TOKEN;
    const token1Decimal = 6;
    const token2Address = DAI_TOKEN;
    const token2Decimal = 18;
    const slippageInBps = 100; // 1%
    let providerAddress;

    before(async function () {
      providerAddress = await getTokenProvider(token1Address);
      this.token = await IToken.at(token1Address);
      this.token2 = await IToken.at(token2Address);
    });

    it('normal', async function () {
      const amount = mwei('500');
      const to = this.hParaSwap.address;

      // Call Paraswap price API
      const priceData = await getPriceData(
        token1Address,
        token1Decimal,
        token2Address,
        token2Decimal,
        amount
      );

      const expectReceivedAmount = priceData.priceRoute.destAmount;

      // Call Paraswap transaction API
      const txData = await getTransactionData(
        priceData,
        slippageInBps,
        this.proxy.address,
        user
      );

      // Prepare handler data
      const callData = getCallData(HParaSwapV5, 'swap', [
        token1Address,
        amount,
        token2Address,
        txData.data,
      ]);

      // Transfer token to proxy
      await this.token.transfer(this.proxy.address, amount, {
        from: providerAddress,
      });

      // Execute
      const receipt = await this.proxy.execMock(to, callData, {
        from: user,
      });

      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );

      const userToken2Balance = await this.token2.balanceOf.call(user);

      // Verify user balance
      expect(handlerReturn).to.be.bignumber.eq(userToken2Balance);
      expect(userToken2Balance).to.be.bignumber.gt(
        mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
      );

      // Proxy should not have remaining token
      expect(
        await this.token2.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
    });
  }); // describe('token to token') end
});

