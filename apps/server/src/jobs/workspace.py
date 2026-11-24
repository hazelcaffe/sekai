"""Runs on the selected computer, as the bot's seat, with one bounded request on stdin.

Open directories component by component: checking realpath before an independent write
would let a renamed symlink redirect the write. Never interpret a file name as shell.
"""
import json, os, resource, stat, subprocess, sys, tempfile

LIMIT = 128 * 1024
DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def descend(fd, parts, create=False):
    for part in parts:
        if not part or part in ('.', '..') or '\\' in part:
            raise ValueError('Choose a path inside the job folder.')
        if create:
            try:
                os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
        child = os.open(part, DIR, dir_fd=fd)
        os.close(fd)
        fd = child
    return fd


def run(req):
    root = req['root']
    base = '/' if root.startswith('/') else os.path.expanduser('~')
    fd = descend(os.open(base, DIR), root.lstrip('/').split('/'), req['op'] == 'init')
    if req['op'] == 'init':
        return 'Ready'
    if req['op'] == 'terminal':
        # No host home, network, credentials, private /etc, sockets or processes.
        # Missing bwrap/user namespaces is a hard failure, never a plain-shell fallback.
        os.fchdir(fd)
        args = ['/usr/bin/bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
                '--cap-drop', 'ALL', '--ro-bind', '/usr/bin', '/usr/bin', '--symlink', 'usr/bin', '/bin',
                '--ro-bind', '/usr/lib', '/usr/lib', '--symlink', 'usr/lib', '/lib',
                '--ro-bind-try', '/usr/lib64', '/usr/lib64', '--symlink', 'usr/lib64', '/lib64',
                '--tmpfs', '/tmp', '--dev', '/dev', '--proc', '/proc', '--bind', '.', '/work',
                '--chdir', '/work', '--setenv', 'HOME', '/tmp', '--setenv', 'PATH', '/usr/bin:/bin',
                '--', '/usr/bin/prlimit', '--nproc=64:64', '--', '/bin/sh', '-c', req['command']]
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 << 20, 16 << 20))
        resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
        resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
        with tempfile.TemporaryFile() as output:
            p = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=60)
            output.seek(0)
            return 'Exit code %d\n%s' % (p.returncode, output.read(16384).decode(errors='replace'))
    parts = req['path'].split('/')
    fd = descend(fd, parts[:-1], req['op'] == 'write_file')
    name = parts[-1]
    if name in ('', '.', '..') or '\\' in name:
        raise ValueError('Choose a file inside the job folder.')
    writing = req['op'] == 'write_file'
    flags = os.O_RDWR | os.O_CREAT if writing else os.O_RDONLY
    file = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=fd)
    with os.fdopen(file, 'r+b' if writing else 'rb') as f:
        info = os.fstat(file)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > LIMIT:
            raise ValueError('Choose a small regular text file, not a link or device.')
        if not writing:
            return f.read(LIMIT).decode()
        data = req['content'].encode()
        if len(data) > LIMIT:
            raise ValueError('The file is too large.')
        before = f.read().decode()
        f.seek(0)
        f.write(data)
        f.truncate()
        import difflib
        return '\n'.join(difflib.unified_diff(before.splitlines(), req['content'].splitlines(), name, name, lineterm=''))[:16384] or 'No change'


try:
    print(json.dumps(run(json.load(sys.stdin))))
except (OSError, ValueError, subprocess.SubprocessError) as err:
    sys.exit(str(err))
