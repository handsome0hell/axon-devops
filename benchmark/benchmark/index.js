const Runner = require('./src/runner')
const config = require('./config.json')
const { ethers } = require('ethers')
const args = require('minimist')(process.argv.slice(2))


async function init_config() {
    
    if(args['http_endpoint']) {
        config.http_endpoint = args['http_endpoint']
    }

    if(args['chain_id']) {
        config.chain_id = args['chain_id']
    }

    if(args['continuous_benchmark']) {
        config.continuous_benchmark = args['continuous_benchmark']
    }


    if(args['benchmark_time']) {
        config.benchmark_time = args['benchmark_time']
    }


    if(args['batch_size']) {
        config.batch_size = args['batch_size']
    }


    if(args['thread_num']) {
        config.thread_num = args['thread_num']
    }


    if(args['id']) {
        config.id = args['id']
    }


    if(args['token']) {
        config.token = args['token']
    }

    if(args['mnemonic']) {
        config.mnemonic = args['token'];
    }

    if(args['uni']) {
        config.mnemonic = args['token'];
    }

    if(args['uniswapFactoryAddress']) {
        config.uniswapFactoryAddress = args['uniswapFactoryAddress'];
    }

    if(args['uniswapNonfungiblePositionManagerAddress']) {
        config.uniswapNonfungiblePositionManagerAddress = args['uniswapNonfungiblePositionManagerAddress'];
    }

    if(args['uniswapSwapRouterAddress']) {
        config.uniswapSwapRouterAddress = args['uniswapSwapRouterAddress'];
    }

    if(args['accounts_num']) {
        config.accounts_num = JSON.parse(args['accounts_num']);
    }

    if(args['mnemonic_index']) {
        config.mnemonic_index = JSON.parse(args['mnemonic_index']);
    }

    if(args['benchmark_cases']) {
        config.benchmark_cases = JSON.parse(args['benchmark_cases'].replaceAll("\'", "\""));
    }
    
    const hdNode = ethers.utils.HDNode.fromMnemonic(config.mnemonic);
    const keys = [];
    for (let i = 0; i < 10; i++) {
        let subNode = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
        keys.push(subNode.privateKey);
    }

    config.private_key = keys[config.mnemonic_index];

}
(async () => {
    await init_config();
    let runner = new Runner(config)
    await runner.run()
})()
