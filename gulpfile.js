'use strict';

var gulp       	 = require('gulp'),
    browserSync	 = require('browser-sync').create(),
    sass       	 = require('gulp-sass')(require('sass')),
    autoprefixer = require('gulp-autoprefixer').default,
    // babel        = require('gulp-babel'),
    rename          = require("gulp-rename"),
    uglify          = require("gulp-uglify-es").default,
    clean           = require('gulp-clean'),
    sharp           = require('sharp'),
    { optimize: svgo } = require('svgo'),
    { Transform }   = require('stream'),
    fs              = require('fs'),
    path            = require('path');

// Minimal replacement for gulp-rigger, which is unmaintained and carried a
// critical advisory through its `rigger` dependency. Same directive syntax the
// sources already use - `//= relative/path` resolved against the including
// file's own directory, recursive, with the directive's indentation applied to
// every included line - so no source file had to change.
function rig() {
    const include = (contents, baseDir, seen) => contents.replace(
        /^([ \t]*)\/\/=\s*(\S+)[ \t]*$/gm,
        (match, indent, target) => {
            const file = path.resolve(baseDir, target);
            if (seen.has(file)) throw new Error('rig: circular include of ' + file);
            if (!fs.existsSync(file)) throw new Error('rig: cannot find ' + file + ' included from ' + baseDir);
            const nested = include(fs.readFileSync(file, 'utf8'), path.dirname(file), new Set(seen).add(file));
            return nested.split('\n').map((line) => (line ? indent + line : line)).join('\n');
        },
    );
    return new Transform({
        objectMode: true,
        transform(file, _enc, cb) {
            if (file.isNull() || !file.contents) return cb(null, file);
            try {
                file.contents = Buffer.from(include(file.contents.toString('utf8'), path.dirname(file.path), new Set([file.path])));
            } catch (err) {
                return cb(err);
            }
            cb(null, file);
        },
    });
}

// Lossless-ish image minification. Replaces the abandoned imagemin binary
// plugins (gulp-imagemin + imagemin-{pngquant,zopfli,gifsicle,jpegtran,mozjpeg}),
// whose bin-wrapper/decompress chain carried a critical advisory with no fix.
function minifyImages() {
    return new Transform({
        objectMode: true,
        async transform(file, _enc, cb) {
            if (file.isNull() || !file.contents) return cb(null, file);
            const ext = file.extname.toLowerCase();
            try {
                if (ext === '.svg') {
                    file.contents = Buffer.from(svgo(file.contents.toString('utf8'), {
                        plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
                    }).data);
                } else if (ext === '.jpg' || ext === '.jpeg') {
                    file.contents = await sharp(file.contents).jpeg({ quality: 90, progressive: true, mozjpeg: true }).toBuffer();
                } else if (ext === '.png') {
                    file.contents = await sharp(file.contents).png({ compressionLevel: 9, palette: true }).toBuffer();
                } else if (ext === '.gif') {
                    file.contents = await sharp(file.contents, { animated: true }).gif({ effort: 10 }).toBuffer();
                }
            } catch (err) {
                this.emit('error', err);
                return cb(null, file);
            }
            cb(null, file);
        },
    });
}

// Compile sass into CSS & auto-inject into browsers

gulp.task('html', gulp.series(function(){
    return gulp.src(['src/**/*.html', '!src/**/_*.html'])
        .pipe(rig())
        .pipe(gulp.dest('dist/'))
        .pipe(browserSync.stream());
}));


gulp.task('sass', function() {
    return gulp.src("src/scss/**/*.scss", { sourcemaps: true })
        .pipe(sass({ style: 'compressed' }).on('error', sass.logError))
        .pipe(autoprefixer({
            cascade: false
        }))
        .pipe(rename({
            suffix: '.min'
        }))
        .pipe(gulp.dest("dist/css", { sourcemaps: "./maps" }))
        .pipe(browserSync.stream());
});


gulp.task('js', function (){
    return gulp.src(['src/js/**/*.js', '!src/js/**/_*.js'], { sourcemaps: true })
        .pipe(rig())
        // .pipe(babel({ presets: ['@babel/env'] }))
        .pipe(uglify())
        .pipe(rename({
            suffix: '.min'
        }))
        .pipe(gulp.dest("dist/js", { sourcemaps: "./maps" }))
        .pipe(browserSync.stream());
});


gulp.task('img', gulp.series( function() {
    return gulp.src(['src/img/**/*.*'], { encoding: false })
        .pipe(minifyImages())
        .pipe(gulp.dest('dist/img'))
        .pipe(browserSync.stream());
}));


gulp.task('docs', gulp.series( function() {
    return gulp.src(['src/docs/**/*.*'])
        .pipe(gulp.dest('dist/docs'))
        .pipe(browserSync.stream());
}));


gulp.task('clean', function (){
    return gulp.src('dist', {allowEmpty: true, read: false}).pipe(clean());
});

// Static Server + watching scss/html files
gulp.task('serve', gulp.series('html', 'sass', 'js', 'img', 'docs', function() {

    browserSync.init({
        server: "./dist"
    });

    gulp.watch("./src/**/*.html",  gulp.parallel('html'));
    gulp.watch("./src/scss/**/*.scss", gulp.parallel('sass'));
    gulp.watch("./src/js/**/*.js", gulp.parallel('js'));
    gulp.watch("./src/img/**/*.*", gulp.parallel('img'));
    gulp.watch("./src/docs/**/*.*", gulp.parallel('docs'));
}));


gulp.task('default', gulp.series('clean', 'html', 'sass', 'js', 'img', 'docs'));