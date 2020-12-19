const { main, callbackFunction } = require("../../goerli_node")
async function connectNode() {
  try {
      await main(callbackFunction)
  } catch (error) {
      console.error('deployment on ropsten network failed', error)
  }
}

connectNode()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
