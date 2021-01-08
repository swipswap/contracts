const { exec } = require('child_process');

exec(`
		openssl req -new -text -passout pass:abcd -subj /CN=localhost -out ./server.req -keyout privkey.pem &&
		openssl rsa -in privkey.pem -passin pass:abcd -out server.key &&
		openssl req -x509 -in server.req -text -key server.key -out server.crt &&
		chmod 600 server.key && sudo chown 70 server.key; rm privkey.pem server.req`
		, (error, _, stderr) => {
    if (error) {
        console.log(`error: ${error.message}`);
        return;
    }
    if (stderr) {
        return;
		}
		console.log(`stdout: ${stdout} Completed`)
	})