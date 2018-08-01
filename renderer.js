// This file is required by the index.html file and will
// be executed in the renderer process for that window.


const fs = require("fs");
const path = require("path");
const { app } = require('electron').remote;
const crypto = require('crypto');
const zlib = require('zlib');
var tar = require('tar-fs'); // If dir, use tar, then gzip


// All info about the files managed by the app are stored on a data.json file
// in userData directory which by default is the appData directory appended with the app name
// see %APPDATA% on windows ; ~/.config on linux ; ~/Library/Application Support on MacOS	
let configFile = path.join(app.getPath('userData'), "data.json");
let config = [];


fs.readFile(configFile, 'utf8', function (err, data) { // We change the banner message depending on if the user is new or not
  if (err) {
  	// No safe was created yet
  	console.log("File doesn't exist");
  	document.getElementById('message').innerHTML = "You don't have any safe yet";
  } else {
	document.querySelector('header h1').innerHTML = "Welcome back to your safe";
	config = JSON.parse(data);
    document.getElementById('message').innerHTML = config.length + " safe(s) found";

	console.log(config);
	updateSafeList();
  }

});

document.getElementById('createSafeButton').addEventListener('click', createNewSafe);


function updateSafeList() { // Add all entries to the GUI
	let ul = document.querySelector("#safeList ul");
	ul.innerHTML = "";
	for (let elt of config) {
		const li = document.createElement('li');
		li.setAttribute("class", "safe");
		const title = document.createElement('h4');
		const litxt = document.createTextNode(elt.name);
		title.appendChild(litxt)
		li.appendChild(title);

		const pwdInput = document.createElement("input");
		const btnDecrypt = document.createElement("button");

		pwdInput.setAttribute("type", "password");
		pwdInput.setAttribute("class", "decryptPwd");
		pwdInput.setAttribute("placeholder", "password");
		
		if (elt.encrypted == true) {
			btnDecrypt.innerHTML = "Decrypt";
		} else {
			btnDecrypt.innerHTML = "Encrypt";
		}
		btnDecrypt.setAttribute("id", "safe"+elt.id);
		li.appendChild(pwdInput);
		li.appendChild(btnDecrypt);
		ul.appendChild(li);

		btnDecrypt.addEventListener('click', toggleEncryption);

	}
}


function createNewSafe() {
	let name = document.getElementById("name").value;
	let folder = document.getElementById("folder").value;
	let password = document.getElementById("password").value;
	
	let safeCreationMessage = document.querySelector("#createSafe h5");

	if (safeNameAlreadyTaken(name)) {
		safeCreationMessage.innerHTML = "You already have a safe with that name";
		safeCreationMessage.style.display = "inline-block";
		return;
	}

	if (password != document.getElementById("confPassword").value) {
		safeCreationMessage.innerHTML = "Passwords do not match";
		safeCreationMessage.style.display = "inline-block";
		return;
	}

	if (!folder || !password) {
		safeCreationMessage.innerHTML = "All fields must be filled";		
		safeCreationMessage.style.display = "inline-block";		
		return;
	}
	safeCreationMessage.style.display = "none";

	let salt = generateSalt(16);
	newSafe = hashWitSalt(password, salt);
	newSafe.path = folder;
	newSafe.name = name;
	newSafe.encrypted = false;
	newSafe.id =  Math.floor((Math.random() * 100) + 1);
	config.push(newSafe);

	updateSafeList();
	saveConfig();
	
}

function safeNameAlreadyTaken(name) {
	for (let elt of config) {
		if (elt.name == name) {
			return true;
		}
	}
	return false;
}

function generateSalt(length) {
	return crypto.randomBytes(Math.ceil(length/2))
		.toString('hex') /** convert to hexadecimal format */
		.slice(0,length);   /** return required number of characters */
}

function hashWitSalt(password, salt) {
	let hash = crypto.createHmac('sha512', salt); /** Hashing algorithm sha512 */
    hash.update(password);
    var value = hash.digest('hex');
    return {
        salt:salt,
        passwordHash:value
    };
}

function saveConfig() {
	fs.writeFile(configFile, JSON.stringify(config), err => {
		if (err) {
			alert("Error, couldn't save config:", err);
		}
	});
}

function toggleEncryption(event) {
	const id = event.srcElement.id.split("safe")[1];
	const pwGiven = event.srcElement.parentElement.querySelector('.decryptPwd').value;
	
	console.log("Toggle encryption for safe with id", id);
	console.log("Given", pwGiven);
	
	let index;
	for (let i = 0; i < config.length; i++) {
		if (config[i].id == id) {
			index = i;
			break;
		}
	}

	if (!checkPassword(pwGiven, config[index].salt, config[index].passwordHash)) {
		console.log("Wrong password");
		return;
	}

	new Promise((resolve, reject) => {
		if (config[index].encrypted) {
			myDecrypt(index, pwGiven);
		}
		else {
			myEncrypt(index, pwGiven);
		}
		resolve();
	}).then(updateSafeList).then(saveConfig);
	
	
	// updateSafeList();
	// saveConfig();

}

async function myDecrypt(i, pw) {
	let isDir = config[i].isDir;
	// If encrypted file was a directory -> recreate a directory
	// To be replaced by tar-fs workflow
	if (isDir) {
		fs.mkdirSync(config[i].path);
	}
	let readStream = fs.createReadStream(config[i].path + '.enc');
	let decrypt = crypto.createDecipher('aes-256-ctr', pw);
	let unzip = zlib.createGunzip();
	let output = fs.createWriteStream(config[i].path);
	// start pipe
	readStream.pipe(decrypt).pipe(unzip).pipe(output);
	fs.unlink(config[i].path+'.enc', err => { // Delete encrypted file
		if (err) throw err;
	})
	config[i].encrypted = false;
}

async function myEncrypt(i, pw) {

	let readStream = fs.createReadStream(config[i].path);
	let zip = zlib.createGzip();
	let encrypt = crypto.createCipher('aes-256-ctr', pw);
	let output = fs.createWriteStream(config[i].path +'.enc');

	// start pipe
	readStream.pipe(zip).pipe(encrypt).pipe(output);

	if (fs.statSync(config[i].path).isDirectory()) {
		fs.rmdir(config[i].path, err => {
			if (err) throw err;
		});
		config[i].isDir = true;
	} else {
		fs.unlink(config[i].path, err => {
			if (err) throw err;
		})
		config[i].isDir = false;
	}
	config[i].encrypted = true;

  };


  function checkPassword(given, salt, hash) {
	let obj = hashWitSalt(given, salt);
	// console.log("Existing hash: ", hash);
	// console.log("Generated hash: ", obj.passwordHash);
	// console.log("Good password ?", obj.passwordHash == hash);

	return obj.passwordHash == hash;
  }