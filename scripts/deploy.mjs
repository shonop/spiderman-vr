// Builds the game and publishes dist/ to the gh-pages branch, which GitHub Pages serves.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const run = (command, cwd) => execSync(command, { stdio: 'inherit', cwd });
const remote = execSync('git remote get-url origin').toString().trim();

run('npm run build');
writeFileSync('dist/.nojekyll', ''); // serve the files as they are
run('git init -q', 'dist');
run('git checkout -q -B gh-pages', 'dist');
run('git add -A', 'dist');
run('git -c user.name=deploy -c user.email=shonop@users.noreply.github.com commit -q -m "Deploy"', 'dist');
run(`git push -f ${remote} gh-pages`, 'dist');
console.log('\nPublished. GitHub Pages updates within a minute or two.');
