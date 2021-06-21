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

  function AndNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    this.name = n.name;
    this.property = n.property;
    this.propertyType = n.propertyType || "msg";
    this.count = parseInt(n.count);

    this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
    this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");

    this.broker = n.broker || this.brokerUrl;
    this.brokerConn =
      this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
    node.brokerConn && node.brokerConn.register(node);

    const inputTopic = `${node.id.replace(".", "")}_input`;
    this.generateCode = true;
    this.deviceHandler = new DeviceHandler(
      node,
      this.brokerConn,
      generateMicropythonCode(this.property, this.count)
    );
    this.deviceHandler.setProxyCallback(sendReading);

    function sendReading(msg) {
      node.send(msg);
    }

    this.topics = [];
    this.inputs = [];

    this.on("input", function (msg, done) {
      try {
        const status = this.deviceHandler.getStatus();
        if (status === "proxy" || status === "remote") {
          msg.payload = { ...msg };
          msg.topic = inputTopic;
          this.brokerConn.publish(msg);
        } else {
          const value = RED.util.getMessageProperty(msg, this.property);

          if (
            Object.prototype.hasOwnProperty.call(msg, "node_id") &&
            this.topics.indexOf(msg.node_id) === -1
          ) {
            this.inputs.push(value);
            this.topics.push(msg.topic);
          }

          if (this.topics.length === this.count) {
            let result = true;
            for (let i = 0; i < this.inputs.length; i++) {
              result = result && this.inputs[i];
            }

            const msg = {
              payload: result,
              node_id: node.id,
              device_id: "node-red",
            };
            node.send(msg);

            this.topics = [];
            this.inputs = [];
          }
        }
      } catch (err) {
        done(JSON.stringify(err));
      }
    });
    this.on("close", function () {
      this.status({});
    });

    generateMicropythonCode(this.property, this.count);

    /**
     * [MINE]
     *
     * Generates micropython code that exxecutes the switch behaviour
     *
     * @param {*} rules
     */
    /* eslint-disable no-unused-vars */
    function generateMicropythonCode(property, count) {
      const textId = node.id.replace(".", "");
      const outputTopics = node.wires
        .map((inner) => inner.map((n) => `${n.replace(".", "")}_input`))
        .flat();
      const inputTopic = `${node.id.replace(".", "")}_input`;

      let code = eval("`\n" + loadCode("and.pyjs", node) + "\n`");

      return code;
    }
    /* eslint-enable no-unused-vars */
  }
  RED.nodes.registerType("and", AndNode);
};
