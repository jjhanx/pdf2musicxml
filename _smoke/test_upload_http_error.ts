import { formatConvertHttpError } from '../shared/uploadHttpError';

const nginx413 = `<html>
<head><title>413 Request Entity Too Large</title></head>
<body>
<center><h1>413 Request Entity Too Large</h1></center>
<hr><center>nginx/1.24.0 (Ubuntu)</center>
</body>
</html>`;

const msg = formatConvertHttpError(413, 'text/html', nginx413);
if (!msg.includes('client_max_body_size 256m')) {
  console.error(msg);
  process.exit(1);
}
const jsonMsg = formatConvertHttpError(400, 'application/json', '{"error":"ZIP 필요","detail":"3단계"}');
if (jsonMsg !== 'ZIP 필요\n3단계') {
  console.error(jsonMsg);
  process.exit(1);
}
console.log('ok');
