const { get, registerHandler, registerCaller } = require('../utils/deploy.js');
const { AAVE_POOL_V3 } = require('../utils/addresses.js');

module.exports = async () => {
  const registry = await get('Registry');
  const handler = await get('HAaveProtocolV3');
  await registerHandler(registry, handler);
  await registerCaller(registry, AAVE_POOL_V3, handler);
};

module.exports.tags = ['HAaveProtocolV3PostSetup'];
module.exports.dependencies = ['Registry', 'HAaveProtocolV3'];
