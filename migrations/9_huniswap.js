const Registry = artifacts.require('Registry');
const Handler = artifacts.require('HUniswap');
const utils = web3.utils;

module.exports = function(deployer) {
  deployer
    .deploy(Handler)
    .then(function() {
      return Registry.deployed();
    })
    .then(function(instance) {
      registry = instance;
      return registry.register(Handler.address, utils.asciiToHex('Uniswap'));
    });
};