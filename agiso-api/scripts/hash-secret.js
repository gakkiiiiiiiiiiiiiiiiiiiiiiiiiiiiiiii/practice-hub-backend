'use strict';

const crypto = require('node:crypto');
const { hashClientSecret } = require('../src/security');

const secret = process.argv[2] || crypto.randomBytes(32).toString('base64url');
process.stdout.write(`client_secret=${secret}\nclient_secret_hash=${hashClientSecret(secret)}\n`);
