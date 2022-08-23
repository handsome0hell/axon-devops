const { ethers } = require('ethers');
const { sleep } = require('./utils');
const {
    Pool,
    Position,
    nearestUsableTick,
    NonfungiblePositionManager,
    encodeSqrtRatioX96,
} = require('@uniswap/v3-sdk');
const { Token, Percent } = require('@uniswap/sdk-core');

const { abi: IUniswapV3PoolInitializerABI } = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/IPoolInitializer.sol/IPoolInitializer.json');
const { abi: IUniswapV3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json');
const { abi: SwapRouterABI } = require('@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IV3SwapRouter.sol/IV3SwapRouter.json');
const Web3 = require('web3');
const AccountFactory = require('./account_factory');
const logger = require('./logger');

async function getPoolImmutables(contract) {
    const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
        contract.factory(),
        contract.token0(),
        contract.token1(),
        contract.fee(),
        contract.tickSpacing(),
        contract.maxLiquidityPerTick(),
    ]);

    return {
        factory,
        token0,
        token1,
        fee,
        tickSpacing,
        maxLiquidityPerTick,
    };
}

async function getPoolState(contract) {
    const [liquidity, slot] = await Promise.all([
        contract.liquidity(),
        contract.slot0(),
    ]);

    return {
        liquidity,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        observationIndex: slot[2],
        observationCardinality: slot[3],
        observationCardinalityNext: slot[4],
        feeProtocol: slot[5],
        unlocked: slot[6],
    };
}

class Benchmark {
    constructor(info) {
        this.config = info.config;

        this.web3 = new Web3(new Web3.providers.HttpProvider(info.config.http_endpoint));

        this.provider = new ethers.providers.JsonRpcProvider(info.config.http_endpoint);

        this.contract = new ethers.Contract(
            info.contracts["UniswapV3Pool"],
            IUniswapV3PoolABI,
            this.provider,
        );
        this.swapRouterContract = new ethers.Contract(
            this.config.uniswapSwapRouterAddress,
            SwapRouterABI,
            this.provider,
        );

        this.accounts = [];
        this.index = 0;
    }

    async prepare() {
        console.log('preparing for uniswapV3_benchmark.js...');

        const accountFactory = new AccountFactory()
        this.accounts = await accountFactory.get_accounts(this.config, 10000000, this.config.accounts_num);

        console.log('\nuniswapV3_benchmark.js prepared');
    }

    async gen_tx() {
        const index = this.index;
        this.index += 1;

        const account = this.accounts[index % this.accounts.length];
        const nonce = await this.web3.eth.getTransactionCount(account.address);

        const [immutables, state] = await Promise.all([
            getPoolImmutables(this.contract),
            getPoolState(this.contract),
        ]);

        const callTx = await this.swapRouterContract.populateTransaction.exactInputSingle({
            tokenIn: immutables.token0,
            tokenOut: immutables.token1,
            fee: immutables.fee,
            recipient: account.address,
            amountIn: 1,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        });

        const tx = {
            ...callTx,
            from: account.address,
            maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei').toString(),
            maxFeePerGas: ethers.utils.parseUnits('2', 'gwei').toString(),
            gasLimit: 60000,
            nonce: nonce + 1,
        };

        return account.signTransaction(tx);
    }

    static async createPool({
        token0,
        token1,
        uniswapNonfungiblePositionManagerAddress,
        signer,
        chainId,
    }) {
        const initializer = new ethers.Contract(
            uniswapNonfungiblePositionManagerAddress,
            IUniswapV3PoolInitializerABI,
            signer,
        );

        const creation = await (await initializer.createAndInitializePoolIfNecessary(
            token0 < token1 ? token0 : token1,
            token0 < token1 ? token1 : token0,
            500,
            encodeSqrtRatioX96(1, 1).toString(),
            { gasLimit: "0x1000000" },
        )).wait();

        let eventInterface = new ethers.utils.Interface(
            ["event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"],
        );
        const poolAddress = eventInterface.parseLog(creation.logs[0]).args.pool;

        console.log(`\npool ${poolAddress} deployed for ${token0} and ${token1}`);

        const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, signer);

        const [immutables, state] = await Promise.all([
            getPoolImmutables(poolContract),
            getPoolState(poolContract),
        ]);

        const tokenA = new Token(chainId, immutables.token0, 18, 'TK0', 'Token 0');

        const tokenB = new Token(chainId, immutables.token1, 18, 'TK1', 'Token 1');

        const pool = new Pool(
            tokenA,
            tokenB,
            immutables.fee,
            state.sqrtPriceX96.toString(),
            state.liquidity.toString(),
            state.tick,
        );

        const position = new Position({
            pool,
            liquidity: 0xfffffff,
            tickLower: nearestUsableTick(state.tick, immutables.tickSpacing) - immutables.tickSpacing * 2,
            tickUpper: nearestUsableTick(state.tick, immutables.tickSpacing) + immutables.tickSpacing * 2,
        });

        const deadline = (await signer.provider.getBlock("latest")).timestamp + 0xfffffff;

        const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, {
            slippageTolerance: new Percent(1, 1),
            recipient: signer.address,
            deadline,
        });

        const tx = {
            data: calldata,
            to: uniswapNonfungiblePositionManagerAddress,
            value: value,
        };

        await (await signer.sendTransaction(
            tx,
        )).wait();

        console.log(`\nposition minted for ${poolAddress}`);

        return poolAddress;
    }
}

module.exports = Benchmark;
