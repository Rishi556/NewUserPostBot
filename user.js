var mongoose = require('mongoose');

var userSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    name: {
        type: String,
        unique: true
    },
    createdBy: String
})


module.exports = mongoose.model("User", userSchema)