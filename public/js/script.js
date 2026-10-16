// Photo upload: preview + validation on the Report page.
// The server re-checks everything, this only gives faster feedback.
(function () {
    var form = document.getElementById('report-form');
    if (!form) return;

    var input = document.getElementById('image');
    var errorBox = document.getElementById('image-error');
    var preview = document.getElementById('image-preview');
    var previewImg = preview.querySelector('img');
    var clearBtn = document.getElementById('image-clear');

    var MAX_SIZE = 5 * 1024 * 1024;
    var ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    var previewUrl = null;

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.hidden = !msg;
    }

    function resetPreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        previewImg.removeAttribute('src');
        preview.hidden = true;
    }

    function check(file) {
        if (!file) return '';
        if (ALLOWED.indexOf(file.type) === -1) return 'Only JPG, PNG, WEBP or GIF images are allowed.';
        if (file.size > MAX_SIZE) return 'The photo must be 5 MB or smaller.';
        return '';
    }

    input.addEventListener('change', function () {
        var file = input.files[0];
        var problem = check(file);

        resetPreview();
        showError(problem);

        if (problem) {
            input.value = '';
            return;
        }

        if (file) {
            previewUrl = URL.createObjectURL(file);
            previewImg.src = previewUrl;
            preview.hidden = false;
        }
    });

    clearBtn.addEventListener('click', function () {
        input.value = '';
        resetPreview();
        showError('');
    });

    form.addEventListener('submit', function (e) {
        var submitBtn = form.querySelector('button[type="submit"]');

        if (!form.checkValidity()) {
            e.preventDefault();
            form.reportValidity();
            return;
        }

        var problem = check(input.files[0]);
        if (problem) {
            e.preventDefault();
            showError(problem);
            return;
        }

        // Stop double submits while the upload is in progress
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading…';
    });
})();
