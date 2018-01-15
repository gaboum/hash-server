const AES = require('../helpers/aes')
const RSA = require('../helpers/rsa')
const validator = require('../helpers/validator')
const crypto = require('crypto')

const Users = require('../models/User')

module.exports = function socketController (socket) {
  console.log(`${socket.id} connected`)

  // Add "data" proprty to the socket to store clients' data
  socket.data = {}

  socket.data.client = {}
  // Generates new RSA key pair per socket connection
  socket.data.server = RSA.generateKey()
  // Generates new AES key per socket connection
  socket.data.common = {
    aesKey: AES.generateKey(),
    nonce: crypto.randomBytes(32)
  }

  socket.on('handshake', data => {
    data = JSON.parse(data)
    socket.data.client.publicKey = data.publicKey
    console.log(`handshake from ${socket.id}. Public Key:\n ${socket.data.client.publicKey}`)

    let encryptedAESKey = RSA.encrypt(socket.data.client.publicKey, socket.data.common.aesKey)
    let handshakeData = {
      server: { publicKey: socket.data.server.publicKey },
      nonce: socket.data.common.nonce,
    }
    let sign = RSA.sign(socket.data.server.privateKey, JSON.stringify(handshakeData))

    let handshakePackage = { data: handshakeData, sign }
    let encryptedHandshakePackage = AES.createAesMessage(socket.data.common.aesKey, JSON.stringify(handshakePackage))

    socket.emit('handshake', { encryptedAESKey, encryptedHandshakePackage })

    // Now client can either register or authenticate
    socket.on('register', data => {
      data = JSON.parse(data)

      let decryptedData = JSON.parse(AES.decrypt(socket.data.common.aesKey, data))
      let request = decryptedData.data
      let signature = decryptedData.sign

      let integrity = RSA.verify(socket.data.client.publicKey, JSON.stringify(request), signature)
      console.log(`register request from ${socket.id}. integrity check ${(integrity ? 'pass' : 'fail')}ed`)

      if (!integrity) {
        socket.emit('error', 'integrity check failed')
      } else if (!validator.registrationRequest(request)) {
        console.log(`register request from ${socket.id} failed: invalid request schema`)
        socket.emit('error', 'invalid request schema')
      } else {
        let newUser = {
          username: request.username,
          password: request.password,
          publicKey: socket.data.client.publicKey
        }
        Users.hashPassword(newUser, (err, user) => {
          if (err) {
            console.log(`register request from ${socket.id} failed: ${err}`)
            socket.emit('error', 'internal error happened')
          } else {
            Users.Users.insert(user, (err, savedUser) => {
              if (err) {
                console.log(`register request from ${socket.id} failed: ${err}`)
                socket.emit('error', `registration error happened`)
              } else {
                console.log(`register request from ${socket.id} succeeded: new user ${newUser._id} saved`)
                // remove the password field from the user object
                delete savedUser.password

                let sign = RSA.sign(socket.data.server.privateKey, JSON.stringify(savedUser))
                let response = { data: savedUser, sign }

                let encryptedResponse = AES.createAesMessage(socket.data.common.aesKey, JSON.stringify(response))

                socket.emit('register', { encryptedResponse })
              }
            })
          }
        })
      }

    })
    socket.on('auth', data => {})
  })
  socket.on('disconnect', () => {
    console.log(`${socket.id} disconnected`)
  })
}
