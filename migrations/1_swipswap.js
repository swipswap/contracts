const SwipSwapEventEmitter = artifacts.require("SwipSwapEventEmitter");
const SwipSwapPool = artifacts.require("SwipSwapPool");
const Token = artifacts.require("Token")
const {setupNode, callbackFunction} = require("../node")

module.exports = async function(deployer, network, address) {
  if(network === 'development') {
    try {
        // await setupNode(async (store) => {
        //     const knownSigner = store.knownSigner
        //     const chainlinkTokenAddress = store.chainlinkToken.address
        //     const chainlinOracleAddress = store.chainlinOracle.address
        //     await deployer.deploy(Token, "Test USD","TUSD", 1_000_000_000)

        //     const tusdcontract = await Token.deployed()

        //     console.log(tusdcontract.address)


        // })
        // await deployer.deploy(SwipSwapEventEmitter)
        // await deployer.deploy(SwipSwapPool)
        // const linkToken = new Token('0x87AE97F105Eba72E3B26dBB27B09bDE5943Df2bD') // Create new instance from chainlink node address
    
        // const emitterAddress = await SwipSwapEventEmitter.deployed()
        // const swipSwapPool = await SwipSwapPool.deployed()
    
        // await linkToken.transfer(swipSwapPool.address, web3.utils.toWei('300'))
        // await swipSwapPool.setEventEmitterAddress(emitterAddress.address) 
        await setupNode(callbackFunction)
    } catch (error) {
        console.log('deployment on development network failed failed')
    }
    

  }
};