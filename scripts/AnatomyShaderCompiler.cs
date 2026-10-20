// Isolated validation helper. No browser, hardware fallback, or file writes.
// Default: compile/link only. Optional probe: ONE bounded CPU-only 1x1 draw,
// never the application's renderer, simulation atlases, or full frame.
// ANGLE's explicit CPU selection contract:
// https://chromium.googlesource.com/angle/angle/+/HEAD/extensions/EGL_ANGLE_platform_angle_device_type_swiftshader.txt
// Attribute constants/ABI: https://chromium.googlesource.com/angle/angle/+/HEAD/include/EGL/eglext_angle.h
// A caller MUST run this in its own disposable process with an external watchdog:
// a native driver/compiler hang cannot be interrupted safely by a managed timer.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace GunterShaderValidation
{
    public sealed class ShaderCompilationResult
    {
        public string Name { get; set; }
        public string Status { get; set; }
        public double ElapsedMilliseconds { get; set; }
        public string Log { get; set; } = "";
        public string VertexLog { get; set; } = "";
        public string FragmentLog { get; set; } = "";
        public string LinkLog { get; set; } = "";
        public string Renderer { get; set; } = "";
        public string GlVersion { get; set; } = "";
        public string EglVersion { get; set; } = "";
        public bool WebGlCompatibility { get; set; }
        public bool PipelineProbe { get; set; }
        public bool ProbeDraw { get; set; }
        public string ProbeStatus { get; set; } = "NOT_REQUESTED";
        public string ProbePrimitive { get; set; } = "";
        public int ProbeVertices { get; set; }
        public int ProbeInstances { get; set; }
        public int ProbeSamplers { get; set; }
        public byte[] ProbePixelRgba8 { get; set; } = new byte[0];
    }

    public static class AnatomyShaderCompiler
    {
        private const int EGL_NONE = 0x3038, EGL_EXTENSIONS = 0x3055;
        private const int EGL_PLATFORM_ANGLE_ANGLE = 0x3202, EGL_PLATFORM_ANGLE_TYPE_ANGLE = 0x3203;
        private const int EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE = 0x3450;
        private const int EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE = 0x3209;
        private const int EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE = 0x3487;
        private const int EGL_OPENGL_ES_API = 0x30A0, EGL_CONTEXT_CLIENT_VERSION = 0x3098;
        private const int EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE = 0x33AC;
        private const uint GL_VERTEX_SHADER = 0x8B31, GL_FRAGMENT_SHADER = 0x8B30;
        private const uint GL_COMPILE_STATUS = 0x8B81, GL_LINK_STATUS = 0x8B82, GL_INFO_LOG_LENGTH = 0x8B84;
        private const uint LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR = 0x100, LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x800;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        // EGLBoolean/GLenum are 32-bit; EGL handles/pointers are pointer-sized.
        // EXT platform attributes are EGLint[] (32-bit), NOT core EGLAttrib[].
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr EglGetProcAddress([MarshalAs(UnmanagedType.LPStr)] string name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr EglQueryString(IntPtr display, int name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int EglGetError();
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr EglGetPlatformDisplayExt(int platform, IntPtr nativeDisplay, [In] int[] attributes);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglInitialize(IntPtr display, out int major, out int minor);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglBindApi(int api);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglChooseConfig(IntPtr display, [In] int[] attributes, [Out] IntPtr[] configs, int size, out int count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr EglCreateContext(IntPtr display, IntPtr config, IntPtr share, [In] int[] attributes);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr EglCreatePbufferSurface(IntPtr display, IntPtr config, [In] int[] attributes);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglMakeCurrent(IntPtr display, IntPtr draw, IntPtr read, IntPtr context);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglDestroyContext(IntPtr display, IntPtr context);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglDestroySurface(IntPtr display, IntPtr surface);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint EglTerminate(IntPtr display);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr GlGetString(uint name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGetInteger(uint name, out int value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GlCreateShader(uint type);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlShaderSource(uint shader, int count, IntPtr strings, IntPtr lengths);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlCompileShader(uint shader);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGetShaderInteger(uint shader, uint name, out int value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGetShaderInfoLog(uint shader, int capacity, out int length, IntPtr log);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GlCreateProgram();
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlAttachShader(uint program, uint shader);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlLinkProgram(uint program);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGetProgramInteger(uint program, uint name, out int value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGetProgramInfoLog(uint program, int capacity, out int length, IntPtr log);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlDeleteShader(uint shader);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlDeleteProgram(uint program);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GlGetError();
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlGenObject(int count, out uint value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlDeleteObject(int count, ref uint value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlBindTexture(uint target, uint value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlTexParameter(uint target, uint name, int value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlTexImage2D(uint target, int level, int internalFormat, int width, int height, int border, uint format, uint type, IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlBindFramebuffer(uint target, uint value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlFramebufferTexture2D(uint target, uint attachment, uint textureTarget, uint texture, int level);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GlCheckFramebufferStatus(uint target);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlBindVertexArray(uint value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlViewport(int x, int y, int width, int height);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlClearColor(float r, float g, float b, float a);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlClear(uint mask);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUseProgram(uint program);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlActiveTexture(uint unit);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GlGetUniformLocation(uint program, [MarshalAs(UnmanagedType.LPStr)] string name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] private delegate void GlGetActiveUniform(uint program, uint index, int capacity, out int length, out int size, out uint type, [Out] StringBuilder name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUniform1i(int location, int value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUniform1f(int location, float value);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUniform2f(int location, float x, float y);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUniform3f(int location, float x, float y, float z);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlUniform4f(int location, float x, float y, float z, float w);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlDrawArrays(uint mode, int first, int count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlDrawArraysInstanced(uint mode, int first, int count, int instances);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlFinish();
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate void GlReadPixels(int x, int y, int width, int height, uint format, uint type, IntPtr data);

        private static T Export<T>(IntPtr module, string name) where T : Delegate
        {
            IntPtr address = GetProcAddress(module, name);
            if (address == IntPtr.Zero) throw new InvalidOperationException("Missing DLL export: " + name);
            return Marshal.GetDelegateForFunctionPointer<T>(address);
        }

        private static T GlFunction<T>(IntPtr module, EglGetProcAddress resolve, string name) where T : Delegate
        {
            IntPtr address = GetProcAddress(module, name);
            if (address == IntPtr.Zero) address = resolve(name);
            if (address == IntPtr.Zero) throw new InvalidOperationException("Missing GLES function: " + name);
            return Marshal.GetDelegateForFunctionPointer<T>(address);
        }

        private static string NativeString(IntPtr value) { return value == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(value); }
        private static bool Extension(string extensions, string name)
        {
            return (" " + extensions + " ").IndexOf(" " + name + " ", StringComparison.Ordinal) >= 0;
        }
        private static void Require(bool okay, string operation, EglGetError getError)
        {
            if (!okay) throw new InvalidOperationException(operation + " failed; EGL error 0x" + getError().ToString("X4"));
        }

        private static void SetSource(uint shader, string source, GlShaderSource submit)
        {
            byte[] utf8 = new UTF8Encoding(false, true).GetBytes(source);
            IntPtr text = IntPtr.Zero, strings = IntPtr.Zero, lengths = IntPtr.Zero;
            try
            {
                text = Marshal.AllocHGlobal(utf8.Length + 1);
                Marshal.Copy(utf8, 0, text, utf8.Length); Marshal.WriteByte(text, utf8.Length, 0);
                strings = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(strings, text);
                lengths = Marshal.AllocHGlobal(4); Marshal.WriteInt32(lengths, utf8.Length);
                submit(shader, 1, strings, lengths);
            }
            finally
            {
                if (lengths != IntPtr.Zero) Marshal.FreeHGlobal(lengths);
                if (strings != IntPtr.Zero) Marshal.FreeHGlobal(strings);
                if (text != IntPtr.Zero) Marshal.FreeHGlobal(text);
            }
        }

        private static string ShaderLog(uint shader, GlGetShaderInteger get, GlGetShaderInfoLog read)
        {
            get(shader, GL_INFO_LOG_LENGTH, out int capacity);
            if (capacity <= 1) return "";
            capacity = Math.Min(capacity, 1024 * 1024);
            IntPtr buffer = Marshal.AllocHGlobal(capacity);
            try { read(shader, capacity, out int length, buffer); return LogText(buffer, length, capacity); }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        private static string ProgramLog(uint program, GlGetProgramInteger get, GlGetProgramInfoLog read)
        {
            get(program, GL_INFO_LOG_LENGTH, out int capacity);
            if (capacity <= 1) return "";
            capacity = Math.Min(capacity, 1024 * 1024);
            IntPtr buffer = Marshal.AllocHGlobal(capacity);
            try { read(program, capacity, out int length, buffer); return LogText(buffer, length, capacity); }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        private static string LogText(IntPtr buffer, int length, int capacity)
        {
            byte[] bytes = new byte[Math.Max(0, Math.Min(length, capacity - 1))];
            Marshal.Copy(buffer, bytes, 0, bytes.Length); return Encoding.UTF8.GetString(bytes);
        }

        private static void ProbePipeline(IntPtr gles, EglGetProcAddress resolve, uint program, string vertexSource, ShaderCompilationResult result)
        {
            // This is a pipeline/driver fixture, not a visual or performance
            // validation. All source programs use float sampler2D; reject any
            // unsupported sampler/uniform instead of pretending it was tested.
            var error = GlFunction<GlGetError>(gles, resolve, "glGetError");
            var genTexture = GlFunction<GlGenObject>(gles, resolve, "glGenTextures");
            var deleteTexture = GlFunction<GlDeleteObject>(gles, resolve, "glDeleteTextures");
            var bindTexture = GlFunction<GlBindTexture>(gles, resolve, "glBindTexture");
            var parameter = GlFunction<GlTexParameter>(gles, resolve, "glTexParameteri");
            var image = GlFunction<GlTexImage2D>(gles, resolve, "glTexImage2D");
            var genFramebuffer = GlFunction<GlGenObject>(gles, resolve, "glGenFramebuffers");
            var deleteFramebuffer = GlFunction<GlDeleteObject>(gles, resolve, "glDeleteFramebuffers");
            var bindFramebuffer = GlFunction<GlBindFramebuffer>(gles, resolve, "glBindFramebuffer");
            var attachTexture = GlFunction<GlFramebufferTexture2D>(gles, resolve, "glFramebufferTexture2D");
            var framebufferStatus = GlFunction<GlCheckFramebufferStatus>(gles, resolve, "glCheckFramebufferStatus");
            var genVao = GlFunction<GlGenObject>(gles, resolve, "glGenVertexArrays");
            var deleteVao = GlFunction<GlDeleteObject>(gles, resolve, "glDeleteVertexArrays");
            var bindVao = GlFunction<GlBindVertexArray>(gles, resolve, "glBindVertexArray");
            var viewport = GlFunction<GlViewport>(gles, resolve, "glViewport");
            var clearColor = GlFunction<GlClearColor>(gles, resolve, "glClearColor");
            var clear = GlFunction<GlClear>(gles, resolve, "glClear");
            var use = GlFunction<GlUseProgram>(gles, resolve, "glUseProgram");
            var activeTexture = GlFunction<GlActiveTexture>(gles, resolve, "glActiveTexture");
            var uniformLocation = GlFunction<GlGetUniformLocation>(gles, resolve, "glGetUniformLocation");
            var activeUniform = GlFunction<GlGetActiveUniform>(gles, resolve, "glGetActiveUniform");
            var getProgram = GlFunction<GlGetProgramInteger>(gles, resolve, "glGetProgramiv");
            var uniform1i = GlFunction<GlUniform1i>(gles, resolve, "glUniform1i");
            var uniform1f = GlFunction<GlUniform1f>(gles, resolve, "glUniform1f");
            var uniform2f = GlFunction<GlUniform2f>(gles, resolve, "glUniform2f");
            var uniform3f = GlFunction<GlUniform3f>(gles, resolve, "glUniform3f");
            var uniform4f = GlFunction<GlUniform4f>(gles, resolve, "glUniform4f");
            var draw = GlFunction<GlDrawArrays>(gles, resolve, "glDrawArrays");
            var drawInstanced = GlFunction<GlDrawArraysInstanced>(gles, resolve, "glDrawArraysInstanced");
            var finish = GlFunction<GlFinish>(gles, resolve, "glFinish");
            var read = GlFunction<GlReadPixels>(gles, resolve, "glReadPixels");
            void Check(string stage) { uint code = error(); if (code != 0) throw new InvalidOperationException(stage + ": GL error 0x" + code.ToString("X4")); }
            uint dummy = 0, history = 0, output = 0, framebuffer = 0, vao = 0;
            uint MakeTexture(int width, int internalFormat, uint type, float[] values)
            {
                genTexture(1, out uint texture); if (texture == 0) throw new InvalidOperationException("Dummy texture allocation failed.");
                try
                {
                    bindTexture(0x0DE1, texture);
                    parameter(0x0DE1, 0x2801, 0x2600); parameter(0x0DE1, 0x2800, 0x2600); // min/mag NEAREST
                    parameter(0x0DE1, 0x2802, 0x812F); parameter(0x0DE1, 0x2803, 0x812F); // CLAMP_TO_EDGE
                    IntPtr data = IntPtr.Zero;
                    try
                    {
                        if (values != null) { data = Marshal.AllocHGlobal(values.Length * 4); Marshal.Copy(values, 0, data, values.Length); }
                        image(0x0DE1, 0, internalFormat, width, 1, 0, 0x1908, type, data);
                    }
                    finally { if (data != IntPtr.Zero) Marshal.FreeHGlobal(data); }
                    Check("Texture fixture"); return texture;
                }
                catch { deleteTexture(1, ref texture); throw; }
            }
            try
            {
                Check("Before pipeline probe");
                dummy = MakeTexture(1, 0x881A, 0x1406, new[] { .2f, .55f, .5f, .8f }); // RGBA16F/FLOAT
                // Only history needs 2x1: shaders divide by historyLength-1
                // and an instanced segment reads both endpoints. A 1x1 history
                // would make the fixture invalid even if GL reported no error.
                history = MakeTexture(2, 0x881A, 0x1406, new[] { -.1f, 0f, 0f, 1f, .1f, 0f, 0f, 1f });
                output = MakeTexture(1, 0x8058, 0x1401, null); // RGBA8/UNSIGNED_BYTE, never sampled
                genFramebuffer(1, out framebuffer); bindFramebuffer(0x8D40, framebuffer);
                attachTexture(0x8D40, 0x8CE0, 0x0DE1, output, 0);
                if (framebufferStatus(0x8D40) != 0x8CD5) throw new InvalidOperationException("1x1 probe framebuffer is incomplete.");
                genVao(1, out vao); bindVao(vao); viewport(0, 0, 1, 1);
                clearColor(0, 0, 0, 0); clear(0x4000); use(program);
                getProgram(program, 0x8B86, out int uniforms); getProgram(program, 0x8B87, out int maxName);
                if (maxName < 0 || maxName > 4096 || uniforms > 256) throw new InvalidOperationException("Uniform fixture exceeds the bounded probe.");
                int sampler = 0;
                for (uint index = 0; index < uniforms; index++)
                {
                    var nameBuffer = new StringBuilder(Math.Max(1, maxName));
                    activeUniform(program, index, nameBuffer.Capacity, out int length, out int size, out uint type, nameBuffer);
                    string name = nameBuffer.ToString(); int location = uniformLocation(program, name);
                    if (location < 0) continue;
                    if (size != 1) throw new InvalidOperationException("Unsupported uniform array in limited probe: " + name);
                    switch (type)
                    {
                        case 0x8B5E: // float sampler2D only; all active samplers get compatible textures
                            if (sampler >= 14) throw new InvalidOperationException("Probe is limited to sampler units 0–13.");
                            activeTexture((uint)(0x84C0 + sampler)); bindTexture(0x0DE1, name == "u_history" ? history : dummy);
                            uniform1i(location, sampler++); break;
                        case 0x1404: case 0x8B56: uniform1i(location, name == "u_initialize" ? 1 : 0); break; // int/bool
                        case 0x1406:
                            float value = name == "u_time" ? 8f : name == "u_dt" ? 1f / 45f
                                : name == "u_visualSize" || name == "u_size" || name == "u_density" || name == "u_brightness"
                                    || name == "u_bioReady" || name == "u_materialWeight" ? 1f : 0f;
                            uniform1f(location, value); break;
                        case 0x8B50: uniform2f(location, name == "u_resolution" ? 1 : 0, name == "u_resolution" ? 1 : 0); break;
                        case 0x8B51:
                            float x = 0, y = 0, z = 0;
                            if (name == "u_shape" || name == "u_transportFrom" || name == "u_transportTo") z = 1;
                            else if (name == "u_flow" || name == "u_previousFlow") x = 1;
                            else if (name == "u_particle") { x = .8f; y = .8f; z = .8f; }
                            else if (name == "u_energy") { x = 1; y = .2f; z = .1f; }
                            else if (name == "u_glow") { x = 1; y = .4f; z = .2f; }
                            else if (name == "u_shadow") { x = .08f; y = .08f; z = .1f; }
                            uniform3f(location, x, y, z); break;
                        case 0x8B52: uniform4f(location, 0, 0, 0, 0); break;
                        default: throw new InvalidOperationException("Unsupported uniform type 0x" + type.ToString("X") + " in limited probe: " + name);
                    }
                }
                result.ProbeSamplers = sampler; Check("Sampler and uniform fixture");
                bool strands = vertexSource.IndexOf("gl_InstanceID", StringComparison.Ordinal) >= 0;
                result.ProbePrimitive = strands ? "TRIANGLE_STRIP" : "TRIANGLES";
                result.ProbeVertices = strands ? 4 : 3; result.ProbeInstances = strands ? 1 : 0;
                result.ProbeDraw = true;
                if (strands) drawInstanced(0x0005, 0, 4, 1); else draw(0x0004, 0, 3);
                finish(); Check("Single 1x1 pipeline draw + glFinish");
                IntPtr pixel = Marshal.AllocHGlobal(4);
                try { read(0, 0, 1, 1, 0x1908, 0x1401, pixel); result.ProbePixelRgba8 = new byte[4]; Marshal.Copy(pixel, result.ProbePixelRgba8, 0, 4); }
                finally { Marshal.FreeHGlobal(pixel); }
                Check("1x1 pipeline readback"); result.ProbeStatus = "PASS";
            }
            finally
            {
                use(0); bindFramebuffer(0x8D40, 0); bindVao(0);
                if (framebuffer != 0) deleteFramebuffer(1, ref framebuffer);
                if (vao != 0) deleteVao(1, ref vao);
                if (output != 0) deleteTexture(1, ref output);
                if (history != 0) deleteTexture(1, ref history);
                if (dummy != 0) deleteTexture(1, ref dummy);
            }
        }

        public static ShaderCompilationResult[] Compile(string libraryDir, string[] names, string[] vertices, string[] fragments, bool probeDraw = false)
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("The inspected ANGLE package requires a 64-bit process.");
            if (names == null || vertices == null || fragments == null || names.Length == 0 || names.Length > 64
                || names.Length != vertices.Length || names.Length != fragments.Length)
                throw new ArgumentException("Expected 1–64 matching program names, vertex sources and fragment sources.");
            if (String.IsNullOrWhiteSpace(libraryDir) || !Path.IsPathFullyQualified(libraryDir) || libraryDir.StartsWith(@"\\", StringComparison.Ordinal))
                throw new ArgumentException("LibraryDirectory must be an absolute local path.");
            libraryDir = Path.GetFullPath(libraryDir);
            string icd = Path.Combine(libraryDir, "vk_swiftshader_icd.json");
            // Defense in depth: the wrapper sets BOTH loader overrides in this
            // child only. Never accept a caller's default hardware ICD instead.
            foreach (string variable in new[] { "VK_ICD_FILENAMES", "VK_DRIVER_FILES" })
            {
                string value = Environment.GetEnvironmentVariable(variable);
                if (String.IsNullOrWhiteSpace(value) || !String.Equals(Path.GetFullPath(value), icd, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(variable + " must identify this package's exact SwiftShader ICD.");
            }
            if (!File.Exists(icd)) throw new FileNotFoundException("SwiftShader ICD not found.", icd);
            foreach (string variable in new[] { "ANGLE_GL_RENDERER", "ANGLE_GL_VENDOR", "ANGLE_GL_VERSION" })
                if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(variable)))
                    throw new InvalidOperationException("Renderer identity override is forbidden: " + variable);

            var results = new List<ShaderCompilationResult>();
            var modules = new List<IntPtr>();
            IntPtr display = IntPtr.Zero, context = IntPtr.Zero, surface = IntPtr.Zero;
            EglMakeCurrent makeCurrent = null; EglDestroySurface destroySurface = null;
            EglDestroyContext destroyContext = null; EglTerminate terminate = null;
            bool initialized = false, current = false, webgl = false;
            string renderer = "", glVersion = "", eglVersion = "", cleanupLog = "";
            var setupClock = Stopwatch.StartNew();
            try
            {
                // Absolute loads, same package, dependencies restricted to the
                // target DLL's directory + Windows System32. No PATH/CWD search.
                foreach (string file in new[] { "vulkan-1.dll", "vk_swiftshader.dll", "libGLESv2.dll", "libEGL.dll" })
                {
                    string path = Path.Combine(libraryDir, file);
                    if (!File.Exists(path)) throw new FileNotFoundException("Required ANGLE/SwiftShader artifact not found.", path);
                    IntPtr module = LoadLibraryExW(path, IntPtr.Zero, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
                    if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not load " + file);
                    modules.Add(module);
                }
                IntPtr gles = modules[2], egl = modules[3];
                var resolve = Export<EglGetProcAddress>(egl, "eglGetProcAddress");
                var query = Export<EglQueryString>(egl, "eglQueryString");
                var getError = Export<EglGetError>(egl, "eglGetError");
                string clientExtensions = NativeString(query(IntPtr.Zero, EGL_EXTENSIONS));
                foreach (string extension in new[] { "EGL_EXT_platform_base", "EGL_ANGLE_platform_angle", "EGL_ANGLE_platform_angle_vulkan", "EGL_ANGLE_platform_angle_device_type_swiftshader" })
                    if (!Extension(clientExtensions, extension)) throw new InvalidOperationException("Required CPU-only EGL extension unavailable: " + extension);
                IntPtr platformAddress = resolve("eglGetPlatformDisplayEXT");
                if (platformAddress == IntPtr.Zero) throw new InvalidOperationException("eglGetPlatformDisplayEXT unavailable; no default-display fallback.");
                var platform = Marshal.GetDelegateForFunctionPointer<EglGetPlatformDisplayExt>(platformAddress);
                var initialize = Export<EglInitialize>(egl, "eglInitialize");
                var bind = Export<EglBindApi>(egl, "eglBindAPI");
                var choose = Export<EglChooseConfig>(egl, "eglChooseConfig");
                var createContext = Export<EglCreateContext>(egl, "eglCreateContext");
                var createPbuffer = Export<EglCreatePbufferSurface>(egl, "eglCreatePbufferSurface");
                makeCurrent = Export<EglMakeCurrent>(egl, "eglMakeCurrent");
                destroySurface = Export<EglDestroySurface>(egl, "eglDestroySurface");
                destroyContext = Export<EglDestroyContext>(egl, "eglDestroyContext");
                terminate = Export<EglTerminate>(egl, "eglTerminate");
                display = platform(EGL_PLATFORM_ANGLE_ANGLE, IntPtr.Zero, new[] {
                    EGL_PLATFORM_ANGLE_TYPE_ANGLE, EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE,
                    EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE, EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE, EGL_NONE });
                Require(display != IntPtr.Zero, "Explicit SwiftShader EGL display", getError);
                Require(initialize(display, out int eglMajor, out int eglMinor) != 0, "eglInitialize", getError);
                initialized = true; eglVersion = eglMajor + "." + eglMinor;
                Require(bind(EGL_OPENGL_ES_API) != 0, "eglBindAPI ES", getError);
                var configs = new IntPtr[1];
                Require(choose(display, new[] { 0x3033, 0x0001, 0x3040, 0x0040, // PBUFFER_BIT, OPENGL_ES3_BIT_KHR
                    0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3025, 0, 0x3026, 0, EGL_NONE }, configs, 1, out int count) != 0 && count > 0,
                    "eglChooseConfig ES3 pbuffer", getError);
                webgl = Extension(NativeString(query(display, EGL_EXTENSIONS)), "EGL_ANGLE_create_context_webgl_compatibility");
                int[] contextAttributes = webgl ? new[] { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE, 1, EGL_NONE }
                    : new[] { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE };
                context = createContext(display, configs[0], IntPtr.Zero, contextAttributes);
                Require(context != IntPtr.Zero, "eglCreateContext ES3", getError);
                surface = createPbuffer(display, configs[0], new[] { 0x3057, 1, 0x3056, 1, EGL_NONE }); // width/height
                Require(surface != IntPtr.Zero, "eglCreatePbufferSurface 1x1", getError);
                Require(makeCurrent(display, surface, surface, context) != 0, "eglMakeCurrent", getError); current = true;

                var getString = GlFunction<GlGetString>(gles, resolve, "glGetString");
                var getInteger = GlFunction<GlGetInteger>(gles, resolve, "glGetIntegerv");
                renderer = NativeString(getString(0x1F01)); glVersion = NativeString(getString(0x1F02));
                if (renderer.IndexOf("SwiftShader", StringComparison.OrdinalIgnoreCase) < 0)
                    throw new InvalidOperationException("Rejected non-SwiftShader renderer: " + renderer);
                getInteger(0x821B, out int glMajor); // GL_MAJOR_VERSION
                if (glMajor < 3) throw new InvalidOperationException("OpenGL ES 3 is unavailable: " + glVersion);
                var createShader = GlFunction<GlCreateShader>(gles, resolve, "glCreateShader");
                var shaderSource = GlFunction<GlShaderSource>(gles, resolve, "glShaderSource");
                var compileShader = GlFunction<GlCompileShader>(gles, resolve, "glCompileShader");
                var shaderInteger = GlFunction<GlGetShaderInteger>(gles, resolve, "glGetShaderiv");
                var shaderLog = GlFunction<GlGetShaderInfoLog>(gles, resolve, "glGetShaderInfoLog");
                var createProgram = GlFunction<GlCreateProgram>(gles, resolve, "glCreateProgram");
                var attach = GlFunction<GlAttachShader>(gles, resolve, "glAttachShader");
                var link = GlFunction<GlLinkProgram>(gles, resolve, "glLinkProgram");
                var programInteger = GlFunction<GlGetProgramInteger>(gles, resolve, "glGetProgramiv");
                var programLog = GlFunction<GlGetProgramInfoLog>(gles, resolve, "glGetProgramInfoLog");
                var deleteShader = GlFunction<GlDeleteShader>(gles, resolve, "glDeleteShader");
                var deleteProgram = GlFunction<GlDeleteProgram>(gles, resolve, "glDeleteProgram");
                setupClock.Stop();

                for (int i = 0; i < names.Length; i++)
                {
                    var result = new ShaderCompilationResult { Name = names[i], Status = "ERROR", Renderer = renderer, PipelineProbe = probeDraw,
                        GlVersion = glVersion, EglVersion = eglVersion, WebGlCompatibility = webgl };
                    results.Add(result); uint vertex = 0, fragment = 0, program = 0; var clock = Stopwatch.StartNew();
                    try
                    {
                        if (String.IsNullOrWhiteSpace(names[i]) || String.IsNullOrWhiteSpace(vertices[i]) || String.IsNullOrWhiteSpace(fragments[i]))
                            throw new ArgumentException("Program name and both GLSL sources must be nonempty.");
                        vertex = createShader(GL_VERTEX_SHADER); fragment = createShader(GL_FRAGMENT_SHADER);
                        if (vertex == 0 || fragment == 0) throw new InvalidOperationException("glCreateShader returned zero.");
                        SetSource(vertex, vertices[i], shaderSource); compileShader(vertex);
                        shaderInteger(vertex, GL_COMPILE_STATUS, out int vertexOkay); result.VertexLog = ShaderLog(vertex, shaderInteger, shaderLog);
                        SetSource(fragment, fragments[i], shaderSource); compileShader(fragment);
                        shaderInteger(fragment, GL_COMPILE_STATUS, out int fragmentOkay); result.FragmentLog = ShaderLog(fragment, shaderInteger, shaderLog);
                        if (vertexOkay == 0 || fragmentOkay == 0) { result.Status = "COMPILE_FAILED"; result.Log = "GLSL compilation failed."; }
                        else
                        {
                            program = createProgram(); if (program == 0) throw new InvalidOperationException("glCreateProgram returned zero.");
                            attach(program, vertex); attach(program, fragment); link(program);
                            programInteger(program, GL_LINK_STATUS, out int linked); result.LinkLog = ProgramLog(program, programInteger, programLog);
                            result.Status = linked != 0 ? "PASS" : "LINK_FAILED"; result.Log = linked != 0 ? "" : "GLSL link failed.";
                            if (linked != 0 && probeDraw)
                            {
                                try { ProbePipeline(gles, resolve, program, vertices[i], result); }
                                catch (Exception error) { result.Status = "PROBE_FAILED"; result.ProbeStatus = "FAIL"; result.Log = error.Message; }
                            }
                        }
                    }
                    catch (Exception error) { result.Status = "ERROR"; result.Log = error.Message; }
                    finally
                    {
                        if (program != 0) deleteProgram(program);
                        if (vertex != 0) deleteShader(vertex);
                        if (fragment != 0) deleteShader(fragment);
                        result.ElapsedMilliseconds = clock.Elapsed.TotalMilliseconds;
                    }
                }
            }
            catch (Exception error)
            {
                for (int i = results.Count; i < names.Length; i++) results.Add(new ShaderCompilationResult { Name = names[i], Status = "SETUP_FAILED",
                    ElapsedMilliseconds = setupClock.Elapsed.TotalMilliseconds, Log = error.Message, Renderer = renderer,
                    GlVersion = glVersion, EglVersion = eglVersion, WebGlCompatibility = webgl, PipelineProbe = probeDraw });
            }
            finally
            {
                try
                {
                    if (current && makeCurrent(display, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero) == 0) cleanupLog += "eglMakeCurrent(clear) failed. ";
                    if (surface != IntPtr.Zero && destroySurface != null && destroySurface(display, surface) == 0) cleanupLog += "eglDestroySurface failed. ";
                    if (context != IntPtr.Zero && destroyContext != null && destroyContext(display, context) == 0) cleanupLog += "eglDestroyContext failed. ";
                    if (initialized && terminate != null && terminate(display) == 0) cleanupLog += "eglTerminate failed. ";
                }
                catch (Exception error) { cleanupLog += "EGL cleanup: " + error.Message + " "; }
                for (int i = modules.Count - 1; i >= 0; i--) if (!FreeLibrary(modules[i])) cleanupLog += "FreeLibrary failed. ";
            }
            if (cleanupLog.Length > 0) foreach (var result in results)
            {
                result.Log = (result.Log + " " + cleanupLog).Trim(); if (result.Status == "PASS") result.Status = "CLEANUP_FAILED";
            }
            return results.ToArray();
        }
    }
}
