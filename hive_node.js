const config = require('./config.json');

const nodes = config.nodes;
let errorCount = 0;
const errorToSwitch = config.errorToSwitch;
let currentNode = '';
switchNode();

function nodeError() {
    errorCount++;
    if (errorCount === errorToSwitch) {
        switchNode();
    }
}

function switchNode() {
    errorCount = 0;
    currentNode = nodes.shift();
    nodes.push(currentNode);
}

function getCurrentNode() {
    return currentNode;
}

module.exports = {
    nodeError,
    switchNode,
    getCurrentNode
};