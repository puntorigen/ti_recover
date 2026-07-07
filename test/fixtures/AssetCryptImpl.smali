.class public Lcl/pabloschaffner/recovered/AssetCryptImpl;
.super Ljava/lang/Object;

.method private static initAssetsBytes()Ljava/nio/CharBuffer;
    .locals 2

    const/16 v0, 0x40

    invoke-static {v0}, Ljava/nio/CharBuffer;->allocate(I)Ljava/nio/CharBuffer;

    move-result-object v0

    const-string v1, "hello\n"

    invoke-virtual {v0, v1}, Ljava/nio/CharBuffer;->append(Ljava/lang/CharSequence;)Ljava/nio/CharBuffer;

    const-string v1, "world"

    invoke-virtual {v0, v1}, Ljava/nio/CharBuffer;->append(Ljava/lang/CharSequence;)Ljava/nio/CharBuffer;

    invoke-virtual {v0}, Ljava/nio/CharBuffer;->rewind()Ljava/nio/Buffer;

    return-object v0
.end method
