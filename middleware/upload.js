const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

// The browser-supplied mimetype can be faked, so also check the file's
// real first bytes ("magic numbers") after it is saved.
function detectImageType(filePath) {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');

    try {
        fs.readSync(fd, buf, 0, 12, 0);
    } finally {
        fs.closeSync(fd);
    }

    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';

    return null;
}

function removeFile(relativePath) {
    if (!relativePath) return;

    // Only ever delete files that live inside public/uploads
    const fullPath = path.join(__dirname, '..', 'public', relativePath);

    if (!fullPath.startsWith(UPLOAD_DIR + path.sep)) return;

    fs.unlink(fullPath, () => {});
}

const multerUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const rand = crypto.randomBytes(12).toString('hex');
            cb(null, `${Date.now()}-${rand}${IMAGE_TYPES[file.mimetype]}`);
        }
    }),
    limits: { fileSize: MAX_SIZE, files: 1 },
    fileFilter: (req, file, cb) => {
        if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
        cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
    }
});

// Middleware: handles one optional "image" field. On any problem it sets
// req.uploadError (a friendly message) instead of throwing, so the route
// can re-render the form with the user's text kept.
function uploadImage(fieldName = 'image') {
    const handler = multerUpload.single(fieldName);

    return (req, res, next) => {
        handler(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    req.uploadError = 'The photo must be 5 MB or smaller.';
                } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    req.uploadError = 'Please upload only one photo.';
                } else {
                    req.uploadError = err.message || 'Unable to upload the photo.';
                }

                return next();
            }

            if (req.file) {
                const real = detectImageType(req.file.path);

                if (!real || IMAGE_TYPES[real] !== path.extname(req.file.filename)) {
                    fs.unlink(req.file.path, () => {});
                    req.file = null;
                    req.uploadError = 'That file is not a valid image.';
                }
            }

            next();
        });
    };
}

module.exports = { uploadImage, removeFile, IMAGE_TYPES, MAX_SIZE };
