using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class OrbitLauncher
{
    [STAThread]
    private static int Main()
    {
        bool acquired = false;
        using (Mutex gate = new Mutex(false, @"Local\CreatorOrbit.DesktopLauncher"))
        {
            try
            {
                try { acquired = gate.WaitOne(0); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) return 0;

                string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
                string script = Path.Combine(root, "scripts", "start.ps1");
                if (!File.Exists(script) || !File.Exists(Path.Combine(root, "server.cjs")))
                    throw new IOException("找不到项目文件。请保留 bin 中的启动器，并使用桌面快捷方式打开；移动项目后请重新运行桌面安装脚本。");

                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
                var start = new ProcessStartInfo(powershell,
                    "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -Quiet");
                start.WorkingDirectory = root;
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.WindowStyle = ProcessWindowStyle.Hidden;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                using (Process process = Process.Start(start))
                {
                    Task<string> output = process.StandardOutput.ReadToEndAsync();
                    Task<string> errors = process.StandardError.ReadToEndAsync();
                    process.WaitForExit();
                    if (process.ExitCode != 0)
                        throw new IOException("工作台启动失败。请确认已安装 Node.js。\n\n" + output.Result + errors.Result +
                            "\n日志：" + Path.Combine(root, "data", "server.stderr.log"));
                }
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "ORBIT · 启动提示", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally { if (acquired) gate.ReleaseMutex(); }
        }
    }
}
