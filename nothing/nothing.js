module.exports = function (RED) {
  const DeviceHandler = require("devicehandler");
  const fs = require('fs');

  function loadCode(filename, node){
    try {
        let data = fs.readFileSync(__dirname + "/" + filename, 'utf8');  
        node.log(`Sucess loading ${filename}`);
        return data;
    } catch(err) {
        node.error(`Error loading ${filename}:${err}`);
    }
    return;
  }


  function NothingNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    this.name = n.name;

    this.micropythonCode = n.micropythonCode || "";

    this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
    this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");

    this.broker = n.broker || this.brokerUrl;
    this.brokerConn =
      this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
    node.brokerConn && node.brokerConn.register(node);

    this.generateCode = true;
    // eslint-disable-next-line no-unused-vars
    const inputTopic = `${node.id.replace(".", "")}_input`;
    this.deviceHandler = new DeviceHandler(
      node,
      this.brokerConn,
      generateMicropythonCode()
    );
    this.deviceHandler.setProxyCallback(sendReading);
    // this.deviceHandler.setLocalCallback(handleFailure);

    function sendReading(msg) {
      node.send(msg);
    }

    this.on("input", function (msg) {
      this.send(msg);
    });

    /**
     * [MINE]
     *
     * Generates micropython code that executes the failure behaviour
     *
     * @param {*} rules
     */
    function generateMicropythonCode() {
      // eslint-disable-next-line no-unused-vars
      const textId = node.id.replace(".", "");
      // eslint-disable-next-line no-unused-vars
      const outputTopics = node.wires
        .map((inner) => inner.map((n) => `${n.replace(".", "")}_input`))
        .flat();
      
      const code = eval('`\n' + loadCode('nop.pyjs', node) + '\n`');
     
      return code;
    }
  }
  RED.nodes.registerType("nothing", NothingNode);
};
