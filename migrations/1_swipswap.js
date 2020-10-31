const {setupNode, callbackFunction} = require("../node")

module.exports = async function(deployer, network, address) {
  if(network === 'development') {
    try {
        await setupNode(callbackFunction)
    } catch (error) {
        console.log('deployment on development network failed failed', error)
    }
  }
};
