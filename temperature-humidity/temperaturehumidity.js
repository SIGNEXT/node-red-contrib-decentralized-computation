module.exports = function (RED) {
  const DeviceHandler = require("devicehandler");
  const fs = require("fs");

  function loadCode(filename, node) {
    try {
      let data = fs.readFileSync(__dirname + "/" + filename, "utf8");
      node.log(`Sucess loading ${filename}`);
      return data;
    } catch (err) {
      node.log(`Error loading ${filename}:${err}`);
    }
    return;
  }

  function TemperatureHumidityNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    const pin = parseInt(n.pin);
    const repeat = Boolean(n.repeat);
    const interval = parseFloat(n.interval);
    // const action = n.action;

    this.broker = n.broker || this.brokerUrl;
    this.brokerConn =
      this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
    node.brokerConn && node.brokerConn.register(node);

    this.generateCode = true;
    this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
    this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");
    this.deviceHandler = new DeviceHandler(
      node,
      this.brokerConn,
      generateMicropythonCode(pin, repeat, interval)
    );
    this.deviceHandler.setProxyCallback(sendReading);
    this.deviceHandler.setLocalCallback(handleFailure);
    // this.deviceHandler.setDeviceDeadCallback(handleFailure);

    this.on("close", function (done) {
      this.status({});
      node.brokerConn.deregister(node, done);
    });

    // Simply send a message through the second output
    function handleFailure() {
      node.send([null, { payload: "Device failed", start: true }]);
    }

    function sendReading(msg) {
      msg.payload = JSON.parse(msg.payload);
      // const reading = RED.util.getMessageProperty(msg, "payload");
      node.send(msg);
    }

    this.on("input", function (msg) {
      const reading = RED.util.getMessageProperty(msg, "payload");
      node.send(reading);
    });

    /**
     * [MINE]
     *
     * Generates micropython code that exxecutes the switch behaviour
     *
     * @param {*} rules
     */
    // eslint-disable-next-line no-unused-vars
    function generateMicropythonCode(pin, repeat, interval) {
      // eslint-disable-next-line no-unused-vars
      const textId = node.id.replace(".", "");
      // eslint-disable-next-line no-unused-vars
      const outputTopics = node.wires
        .map((inner) => inner.map((n) => `${n.replace(".", "")}_input`))
        .flat();

      const code = eval("`\n" + loadCode("temphum.pyjs", node) + "\n`");
      return code;
    }
  }
  RED.nodes.registerType("temperature-humidity", TemperatureHumidityNode);
};
