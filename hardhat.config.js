const {setupNode, callbackFunction} = require("./node")

task("startnode", "Auto deploy and set up", async () => {
    try {
        await setupNode(callbackFunction)
    } catch (error) {
        console.log('deployment on development network failed failed', error)
    }
});

module.exports = {
    solidity: "0.6.9",
    defaultNetwork: "localhost",
    hardhat: {},
    localhost: {
        url: "http://127.0.0.1:6690",
    }
};

