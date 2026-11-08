package io.github.mingzifu9.pocketai;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Map;

/**
 * 课程网页用“目录式地址”（如 /courses/cloud/、chapters/01-intro/），浏览器里服务器会自动给出该目录下的 index.html。
 * Capacitor 自带的本地服务器不会这样做：没有扩展名的地址一律返回 APP 首页，导致点“进入课程”没反应。
 * 这里把目录式地址改成读取对应目录的 index.html，页面地址本身不变，所以页面里的相对链接照常工作。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String path = url.getPath();
                if ("localhost".equals(url.getHost()) && path != null && !path.equals("/")) {
                    String last = url.getLastPathSegment();
                    boolean isDirectory = path.endsWith("/") || (last != null && !last.contains("."));
                    if (isDirectory) {
                        String indexPath = path.endsWith("/") ? path + "index.html" : path + "/index.html";
                        request = new RewrittenRequest(request, url.buildUpon().path(indexPath).build());
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    /** 只替换地址、其余信息原样保留的请求 */
    private static final class RewrittenRequest implements WebResourceRequest {
        private final WebResourceRequest original;
        private final Uri url;

        RewrittenRequest(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return original.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return original.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return original.hasGesture();
        }

        @Override
        public String getMethod() {
            return original.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return original.getRequestHeaders();
        }
    }
}
