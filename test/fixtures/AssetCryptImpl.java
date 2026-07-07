package cl.pabloschaffner.recovered;

import java.util.HashMap;

public class AssetCryptImpl {
    private static HashMap<String, Range> hashMap = new HashMap<>();

    static {
        hashMap.put("app.js", new Range(0, 128));
        hashMap.put("alloy.js", new Range(128, 64));
        hashMap.put("ui/index.js", new Range(0xC0, 256));
    }

    static class Range {
        int offset;
        int length;

        Range(int offset, int length) {
            this.offset = offset;
            this.length = length;
        }
    }
}
