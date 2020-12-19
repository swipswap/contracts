const { setupNode, callbackFunction } = require("./ropsten/deployer")
async function deployNode() {
  try {
      await setupNode(callbackFunction)
  } catch (error) {
      console.error('deployment on local network failed', error)
  }
}

deployNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
