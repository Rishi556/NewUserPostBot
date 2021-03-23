let axios = require("axios")
let config = require("./config.json")
let state = require("./state.json")
let hive_node = require("./hive_node.js")
let fs = require("fs")
let User = require("./user.js")
let mongoose = require("mongoose")

let connection = mongoose.connect(config.mongo_url, {useUnifiedTopology: true, useNewUrlParser: true})
let lastParsedBlock = 0

startStreaming()

async function startStreaming() {
    const startBlock = await getStartStreamBlock();
    getBlock(startBlock);
}

async function getStartStreamBlock() {
    return new Promise((resolve, reject) => {
        if (state.last_parsed_block && state.last_parsed_block !== -1) {
            return resolve(state.last_parsed_block)
        }
        axios.post(hive_node.getCurrentNode(), {
            'id': 0,
            'jsonrpc': '2.0',
            'method': 'condenser_api.get_dynamic_global_properties',
            'params': []
        }).then((res) => {
            if (res.data.result) {
                return resolve(res.data.result.last_irreversible_block_num);
            } else {
                logger.error('Wasn\'t able to get first block. Attempting to change nodes and try again.');
                hive_node.switchNode();
                startStreaming();
                return reject();
            }
        }).catch(() => {
            logger.error('Wasn\'t able to get first block. Attempting to change nodes and try again.');
            hive_node.switchNode();
            startStreaming();
            return reject();
        })
    })

}

function getBlock(blockNumber) {
    let nextBlock = false;
    axios.post(hive_node.getCurrentNode(), {
        'id': blockNumber,
        'jsonrpc': '2.0',
        'method': 'call',
        'params': ['condenser_api', 'get_block', [blockNumber]]
    }).then((res) => {
        if (res.data.result) {
            const block = res.data.result;
            nextBlock = true;
            lastParsedBlock = blockNumber;
            parseBlock(block);
        }
    }).finally(() => {
        if (nextBlock) {
            setTimeout(() => {
                getBlock(blockNumber + 1);
            }, 0.5 * 1000);
        } else {
            hive_node.nodeError();
            setTimeout(() => {
                getBlock(blockNumber);
            }, 1.5 * 1000);
        }
    });
}


function parseBlock(block) {
    if (block.transactions.length !== 0) {
        const trxs = block.transactions;
        for (const i in trxs) {
            const trx = trxs[i];
            parseTrx(trx);
        }
    }
}

function parseTrx(trx) {
    const ops = trx.operations;
    for (const i in ops) {
        const op = ops[i];
        if (op[0] === 'account_create' || op[0] === 'create_claimed_account') {
            let action = op[1]
            let creator = action.creator
            let newUser = action.new_account_name
            if (config.creator_to_skip.includes(creator)) {
                continue
            }
            let userToSave = new User({
                _id: new mongoose.Types.ObjectId(),
                name: newUser,
                createdBy: creator
            })
            userToSave.save().then(() => {
                console.log("Added new user: " + newUser)
            }).catch((err) => {
                console.error("Couldn't save user " + newUser, err)
            })
        }
        if (op[0] === "comment") {
            let action = op[1]
            if (action.parent_author === "") {
                let author = action.author
                User.findOne({name: author}).then((res) => {
                    if (res) {
                        let title = action.title
                        let permlink = action.permlink
                        let tags = [action.parent_permlink]
                        try {
                            let metadata = JSON.parse(action.json_metadata)
                            let tagsOnPost = metadata.tags
                            tags = tags.concat(tagsOnPost)
                        } catch (e) {
                            //Ignore since it just means tags were borked when saving
                        }
                        let s = new Set(tags);
                        let sValues = s.values();
                        tags = Array.from(sValues);
                        let niceTags = `**${tags[0]}**`
                        for (let i = 1; i < tags.length; i++) {
                            niceTags += ` | ${tags[i]}`
                        }
                        let send = {
                            "content": null,
                            "embeds": [
                                {
                                    "title": `@${author} made a post`,
                                    "url": `https://hivel.ink/@${author}/${permlink}`,
                                    "color": 16711680,
                                    "fields": [
                                        {
                                            "name": "Post Title",
                                            "value": title
                                        },
                                        {
                                            "name": "Account Made By",
                                            "value": res.createdBy
                                        },
                                        {
                                            "name": "Tags",
                                            "value": niceTags
                                        }
                                    ],
                                    "author": {
                                        "name": "Post By A New User Detected",
                                        "icon_url": `https://images.hive.blog/u/${author}/avatar`
                                    },
                                    "footer": {
                                        "text": "This Bot Was Created By @Rishi556"
                                    }
                                }
                            ]
                        }
                        for (let i in config.discord_webhook_urls) {
                            axios.post(config.discord_webhook_urls[i], send)
                        }
                        User.findByIdAndDelete(res._id).catch((err) => {
                            console.error("Couldn't delete user", err)
                        })
                    }
                }).catch((err) => {
                    console.error("Couldn't find user", err)
                })
            }
        }
    }
}

setInterval(() => {
    fs.writeFile("./state.json", JSON.stringify({last_parsed_block: lastParsedBlock}), (err, res) => {
        if (err) {
            console.error("Couldn't save last parsed block", err)
        }
    })
}, 1000 * 60)
