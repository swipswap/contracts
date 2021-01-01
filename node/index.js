const { connectAndGetProvider, getAddressFunder, getDeployer, getNodeAddress, deployments, config } = require("./script")
const callbackFunction = require('./callback')

const main = async (callbackFunction=()=>{}) => {
	let _store = {}

    _store.provider = await connectAndGetProvider()
    const fundAddress = getAddressFunder(_store.provider)
    _store.deployer = await getDeployer(_store.provider)
    const signerBalance = await _store.deployer.getBalance()

    if(Number(signerBalance) === 0) {
        await fundAddress(await _store.deployer.getAddress(), 1)
        console.log(`Funded deploying account [${await _store.deployer.getAddress()}] with ETH`)
    }

    const testAddressBalance = await _store.provider.getBalance(config.testAddress)
    if(Number(testAddressBalance) === 0) {
        await fundAddress(config.testAddress)
        console.log('Funded test address with ETH')
    }
            
    _store.nodeAddress = await getNodeAddress()
    if(_store.nodeAddress === ""){
        console.error("Unable to get chainlink node address")
        return
    }

    if(_store.nodeAddress !== deployments.nodeAddress && deployments.nodeAddress) {
        console.info('Node Address is different from the one in the deployments.')
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        readline.question('Continue? Y/N >> ', answer => {
            readline.close();
            if(answer.toUpperCase() === "N"){
                console.warn("Aborting...")
                process.exit(0)
            }
        });
    }

    const nodeAddressBalance = await _store.provider.getBalance(_store.nodeAddress)
    if(Number(nodeAddressBalance) === 0) {
        await fundAddress(_store.nodeAddress, 1)
        console.log('Funded chainlink node account with ETH')
    }
				
    await callbackFunction(_store)
}

main(callbackFunction)
