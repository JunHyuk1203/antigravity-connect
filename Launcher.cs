using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Text;
using System.Net;

namespace AntigravityConnect
{
    public class LauncherForm : Form
    {
        private TextBox txtRoomId;
        private Button btnRandom;
        private Button btnHost;
        private Button btnGuest;
        private TextBox txtLog;
        private Process bridgeProcess;
        private Label lblStatus;

        public LauncherForm()
        {
            InitializeComponent();
            GenerateRandomRoom();
        }

        private void InitializeComponent()
        {
            this.Text = "Antigravity Connect Launcher";
            this.Size = new Size(520, 500);
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(13, 17, 23); // #0D1117
            this.ForeColor = Color.FromArgb(230, 237, 243); // #E6EDF3
            this.Font = new Font("Segoe UI", 9.5f);
            this.StartPosition = FormStartPosition.CenterScreen;

            // Brand Logo / Title
            Label lblLogo = new Label();
            lblLogo.Text = "▲ ANTIGRAVITY CONNECT";
            lblLogo.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
            lblLogo.ForeColor = Color.FromArgb(59, 130, 246); // #3B82F6
            lblLogo.Location = new Point(25, 20);
            lblLogo.Size = new Size(470, 30);
            lblLogo.TextAlign = ContentAlignment.MiddleLeft;
            this.Controls.Add(lblLogo);

            // Subtitle
            Label lblSubtitle = new Label();
            lblSubtitle.Text = "실시간 협업 코딩 및 IDE AI 브릿지 런처";
            lblSubtitle.Font = new Font("Segoe UI", 9.5f, FontStyle.Italic);
            lblSubtitle.ForeColor = Color.FromArgb(139, 148, 158); // #8B949E
            lblSubtitle.Location = new Point(25, 52);
            lblSubtitle.Size = new Size(470, 20);
            this.Controls.Add(lblSubtitle);

            // Group: Room ID
            Label lblRoom = new Label();
            lblRoom.Text = "ROOM ID (룸 식별자)";
            lblRoom.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblRoom.ForeColor = Color.FromArgb(139, 148, 158);
            lblRoom.Location = new Point(25, 90);
            lblRoom.Size = new Size(200, 20);
            this.Controls.Add(lblRoom);

            txtRoomId = new TextBox();
            txtRoomId.Location = new Point(25, 112);
            txtRoomId.Size = new Size(330, 26);
            txtRoomId.BackColor = Color.FromArgb(22, 27, 34); // #161B22
            txtRoomId.ForeColor = Color.FromArgb(230, 237, 243);
            txtRoomId.BorderStyle = BorderStyle.FixedSingle;
            txtRoomId.Font = new Font("Segoe UI", 11f);
            this.Controls.Add(txtRoomId);

            btnRandom = new Button();
            btnRandom.Text = "랜덤 생성";
            btnRandom.Location = new Point(365, 112);
            btnRandom.Size = new Size(115, 26);
            btnRandom.BackColor = Color.FromArgb(33, 38, 45); // #21262D
            btnRandom.ForeColor = Color.FromArgb(201, 209, 217);
            btnRandom.FlatStyle = FlatStyle.Flat;
            btnRandom.FlatAppearance.BorderColor = Color.FromArgb(48, 54, 61);
            btnRandom.Cursor = Cursors.Hand;
            btnRandom.Click += (s, e) => GenerateRandomRoom();
            this.Controls.Add(btnRandom);

            // Host Button
            btnHost = new Button();
            btnHost.Text = "🚀 호스트 모드로 시작 (IDE 브릿지 연동)";
            btnHost.Location = new Point(25, 160);
            btnHost.Size = new Size(455, 38);
            btnHost.BackColor = Color.FromArgb(35, 134, 54); // #238636 (Green)
            btnHost.ForeColor = Color.White;
            btnHost.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnHost.FlatStyle = FlatStyle.Flat;
            btnHost.FlatAppearance.BorderSize = 0;
            btnHost.Cursor = Cursors.Hand;
            btnHost.Click += BtnHost_Click;
            this.Controls.Add(btnHost);

            // Guest Button
            btnGuest = new Button();
            btnGuest.Text = "🌐 게스트로 참가 (웹 브라우저 열기)";
            btnGuest.Location = new Point(25, 208);
            btnGuest.Size = new Size(455, 38);
            btnGuest.BackColor = Color.FromArgb(31, 111, 235); // #1F6FEB (Blue)
            btnGuest.ForeColor = Color.White;
            btnGuest.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnGuest.FlatStyle = FlatStyle.Flat;
            btnGuest.FlatAppearance.BorderSize = 0;
            btnGuest.Cursor = Cursors.Hand;
            btnGuest.Click += BtnGuest_Click;
            this.Controls.Add(btnGuest);

            // Status / Log Title
            lblStatus = new Label();
            lblStatus.Text = "시스템 로그";
            lblStatus.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblStatus.ForeColor = Color.FromArgb(139, 148, 158);
            lblStatus.Location = new Point(25, 260);
            lblStatus.Size = new Size(450, 20);
            this.Controls.Add(lblStatus);

            // Log Console
            txtLog = new TextBox();
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.Location = new Point(25, 282);
            txtLog.Size = new Size(455, 150);
            txtLog.BackColor = Color.FromArgb(4, 4, 6);
            txtLog.ForeColor = Color.FromArgb(139, 148, 158);
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            txtLog.Font = new Font("Consolas", 9.5f);
            this.Controls.Add(txtLog);

            Log("Antigravity Connect 런처 준비 완료.");
            Log("팁: Node.js가 설치되어 있지 않아도 포터블 파일 다운로드를 통해 원클릭 가동이 가능합니다.");

            this.FormClosing += LauncherForm_FormClosing;
        }

        private void GenerateRandomRoom()
        {
            Random rand = new Random();
            int num = rand.Next(100, 1000); // 100 to 999
            txtRoomId.Text = num.ToString();
        }

        private void Log(string message)
        {
            if (txtLog.InvokeRequired)
            {
                txtLog.Invoke(new Action<string>(Log), message);
                return;
            }
            txtLog.AppendText(string.Format("[{0}] {1}{2}", DateTime.Now.ToString("HH:mm:ss"), message, Environment.NewLine));
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(url);
                Log(string.Format("웹 접속 열기: {0}", url));
            }
            catch
            {
                try
                {
                    // Fallback using explorer.exe to bypass default browser registration issues
                    Process.Start("explorer.exe", "\"" + url + "\"");
                    Log(string.Format("웹 접속 열기(explorer fallback): {0}", url));
                }
                catch (Exception ex)
                {
                    Log(string.Format("❌ 에러: 브라우저 실행 실패 ({0})", ex.Message));
                    MessageBox.Show(string.Format("브라우저를 자동으로 실행할 수 없습니다.\n아래 주소로 직접 접속해 주세요:\n\n{0}", url), "알림", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }

        private void BtnGuest_Click(object sender, EventArgs e)
        {
            string room = txtRoomId.Text.Trim();
            if (string.IsNullOrEmpty(room))
            {
                MessageBox.Show("Room ID를 입력해 주세요.", "알림", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string url = string.Format("https://JunHyuk1203.github.io/antigravity-connect/#room={0}", room);
            OpenUrl(url);
        }

        private void BtnHost_Click(object sender, EventArgs e)
        {
            if (bridgeProcess != null && !bridgeProcess.HasExited)
            {
                StopBridge();
                return;
            }

            string room = txtRoomId.Text.Trim();
            if (string.IsNullOrEmpty(room))
            {
                MessageBox.Show("Room ID를 입력해 주세요.", "알림", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string bridgeScript = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ag-bridge.mjs");
            if (!File.Exists(bridgeScript))
            {
                MessageBox.Show(string.Format("ag-bridge.mjs 파일을 찾을 수 없습니다.\n런처는 ag-bridge.mjs 파일이 위치한 폴더에서 실행되어야 합니다.\n\n경로: {0}", bridgeScript), "에러", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Check if local node.exe exists
            string localNodePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe");
            if (File.Exists(localNodePath))
            {
                StartBridge(room, localNodePath);
                return;
            }

            // Test if global node is available
            try
            {
                ProcessStartInfo testPsi = new ProcessStartInfo();
                testPsi.FileName = "node";
                testPsi.Arguments = "--version";
                testPsi.UseShellExecute = false;
                testPsi.CreateNoWindow = true;
                using (Process p = Process.Start(testPsi))
                {
                    p.WaitForExit(1000);
                }
                StartBridge(room, "node");
            }
            catch
            {
                // Global node not found, offer portable download
                var result = MessageBox.Show(
                    "이 컴퓨터에 Node.js가 설치되어 있지 않습니다.\n\n원활한 브릿지 구동을 위해 30MB 크기의 무설정 포터블 Node.js(node.exe)를 현재 폴더에 자동 다운로드하여 실행할까요?\n(직접 설치하지 않고 클릭 한 번으로 간편하게 시작할 수 있습니다.)",
                    "Node.js 미설치",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );

                if (result == DialogResult.Yes)
                {
                    DownloadPortableNode(room);
                }
                else
                {
                    Log("❌ 호스트 시작 취소: Node.js가 필요합니다.");
                }
            }
        }

        private void DownloadPortableNode(string room)
        {
            string localNodePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe");
            Log("포터블 Node.js(node.exe) 다운로드를 시작합니다 (약 30MB)...");
            btnHost.Enabled = false;

            try
            {
                using (WebClient client = new WebClient())
                {
                    try
                    {
                        // Enable TLS 1.2 for Node.js download mirror (encased in try-catch to support older JIT)
                        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                    }
                    catch (Exception ex)
                    {
                        Log("⚠️ TLS 1.2 강제 활성화 실패 (시스템 fallback): " + ex.Message);
                    }

                    client.DownloadProgressChanged += (s, e) => {
                        lblStatus.Text = string.Format("포터블 Node.js 다운로드 중... {0}%", e.ProgressPercentage);
                    };

                    client.DownloadFileCompleted += (s, e) => {
                        if (e.Error != null)
                        {
                            Log("❌ 다운로드 실패: " + e.Error.Message);
                            lblStatus.Text = "다운로드 실패";
                            btnHost.Enabled = true;
                            UpdateHostButtonState(false);
                            MessageBox.Show("Node.js 다운로드에 실패했습니다. 공식 홈페이지에서 직접 설치해 주세요.", "에러", MessageBoxButtons.OK, MessageBoxIcon.Error);
                            OpenUrl("https://nodejs.org/");
                            return;
                        }

                        Log("✅ 포터블 Node.js 다운로드 완료!");
                        lblStatus.Text = "다운로드 완료";
                        btnHost.Enabled = true;

                        // Start bridge with downloaded local node.exe
                        StartBridge(room, localNodePath);
                    };

                    client.DownloadFileAsync(new Uri("https://nodejs.org/dist/v20.11.0/win-x64/node.exe"), localNodePath);
                }
            }
            catch (Exception ex)
            {
                Log("❌ 다운로드 오류: " + ex.Message);
                btnHost.Enabled = true;
                UpdateHostButtonState(false);
            }
        }

        private void StartBridge(string room, string nodePath)
        {
            string bridgeScript = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ag-bridge.mjs");
            Log(string.Format("로컬 IDE 브릿지 구동 시도... (Room: {0}, Executable: {1})", room, nodePath));

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = string.Format("\"{0}\" --room {1}", bridgeScript, room);
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;

                bridgeProcess = new Process();
                bridgeProcess.StartInfo = psi;
                bridgeProcess.EnableRaisingEvents = true;

                bridgeProcess.OutputDataReceived += (s, ev) => {
                    if (ev.Data != null) Log(ev.Data);
                };
                bridgeProcess.ErrorDataReceived += (s, ev) => {
                    if (ev.Data != null) Log("[Error] " + ev.Data);
                };

                bridgeProcess.Exited += (s, ev) => {
                    Log("브릿지 프로세스가 종료되었습니다.");
                    UpdateHostButtonState(false);
                };

                bridgeProcess.Start();
                bridgeProcess.BeginOutputReadLine();
                bridgeProcess.BeginErrorReadLine();

                Log("✅ 브릿지 프로세스 시작 성공!");
                UpdateHostButtonState(true);

                // Open browser
                string url = string.Format("https://JunHyuk1203.github.io/antigravity-connect/#room={0}", room);
                OpenUrl(url);
            }
            catch (Exception ex)
            {
                Log(string.Format("❌ 에러: 브릿지 실행 실패 ({0})", ex.Message));
                MessageBox.Show("브릿지 실행에 실패했습니다. 파일 권한 또는 실행 경로를 확인해 주세요.", "실행 에러", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void UpdateHostButtonState(bool running)
        {
            if (btnHost.InvokeRequired)
            {
                btnHost.Invoke(new Action<bool>(UpdateHostButtonState), running);
                return;
            }

            if (running)
            {
                btnHost.Text = "🛑 호스트 중단 (브릿지 종료)";
                btnHost.BackColor = Color.FromArgb(248, 81, 73); // #F85149 (Red)
                txtRoomId.Enabled = false;
                btnRandom.Enabled = false;
                btnGuest.Enabled = false;
                lblStatus.Text = "시스템 로그 (● 호스트 활성화 상태)";
                lblStatus.ForeColor = Color.FromArgb(63, 185, 80); // Green
            }
            else
            {
                btnHost.Text = "🚀 호스트 모드로 시작 (IDE 브릿지 연동)";
                btnHost.BackColor = Color.FromArgb(35, 134, 54); // #238636 (Green)
                txtRoomId.Enabled = true;
                btnRandom.Enabled = true;
                btnGuest.Enabled = true;
                lblStatus.Text = "시스템 로그";
                lblStatus.ForeColor = Color.FromArgb(139, 148, 158);
            }
        }

        private void StopBridge()
        {
            if (bridgeProcess != null && !bridgeProcess.HasExited)
            {
                Log("브릿지 종료 요청 중...");
                try
                {
                    bridgeProcess.Kill();
                    bridgeProcess.Dispose();
                }
                catch {}
                bridgeProcess = null;
            }
        }

        private void LauncherForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            StopBridge();
        }

        [STAThread]
        public static void Main()
        {
            // Global Exception Diagnostic Handler to catch and show JIT errors on startup
            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                MessageBox.Show(
                    "프로그램 시작 중 치명적인 예외가 발생했습니다:\n\n" + e.ExceptionObject.ToString(),
                    "Antigravity Connect Launcher 오류",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            };

            try
            {
                RunApp();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "프로그램 가동 중 치명적인 에러가 발생했습니다:\n\n" + ex.ToString(),
                    "Antigravity Connect Launcher 치명적 오류",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static void RunApp()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }
}
