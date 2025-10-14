const multer = require('multer');

// Set up file storage using multer
const upload = multer({ dest: 'uploads/' });

module.exports = upload;
