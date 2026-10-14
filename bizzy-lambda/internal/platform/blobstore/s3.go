package blobstore

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// pendingTag marks an upload not yet confirmed; the bucket's lifecycle rule
// expires objects carrying it.
const pendingTag = "pending=true"

// S3 is the Store over one bucket.
type S3 struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

// NewS3 builds the store from the Lambda environment's credentials.
func NewS3(ctx context.Context, bucket string) (*S3, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		// By default the SDK signs a CRC32 of the (empty) body into a
		// presigned PUT, which the browser's upload then fails.
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	return &S3{client: client, presign: s3.NewPresignClient(client), bucket: bucket}, nil
}

func (s *S3) PresignPut(ctx context.Context, key, contentType string, size int64, expiry time.Duration) (Upload, error) {
	req, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(size),
		Tagging:       aws.String(pendingTag),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return Upload{}, err
	}
	headers := map[string]string{}
	for name, values := range req.SignedHeader {
		switch strings.ToLower(name) {
		case "host", "content-length":
			// The browser sets these itself, and refuses to be told.
		default:
			headers[name] = strings.Join(values, ",")
		}
	}
	return Upload{URL: req.URL, Headers: headers}, nil
}

func (s *S3) PresignGet(ctx context.Context, key, filename string, download bool, expiry time.Duration) (string, error) {
	disposition := "inline"
	if download {
		disposition = "attachment"
	}
	if filename != "" {
		// RFC 2231-encodes a name that isn't plain ASCII.
		disposition = mime.FormatMediaType(disposition, map[string]string{"filename": filename})
	}
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     aws.String(s.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String(disposition),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *S3) Confirm(ctx context.Context, key string) (Object, error) {
	head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		var notFound *types.NotFound
		var apiErr smithy.APIError
		if errors.As(err, &notFound) || (errors.As(err, &apiErr) && apiErr.ErrorCode() == "NotFound") {
			return Object{}, ErrMissing
		}
		return Object{}, err
	}
	if _, err := s.client.DeleteObjectTagging(ctx, &s3.DeleteObjectTaggingInput{Bucket: aws.String(s.bucket), Key: aws.String(key)}); err != nil {
		return Object{}, err
	}
	return Object{Size: aws.ToInt64(head.ContentLength), ContentType: aws.ToString(head.ContentType)}, nil
}

// deleteBatch is the most keys one DeleteObjects takes.
const deleteBatch = 1000

func (s *S3) Delete(ctx context.Context, keys ...string) error {
	for start := 0; start < len(keys); start += deleteBatch {
		batch := keys[start:min(start+deleteBatch, len(keys))]
		objects := make([]types.ObjectIdentifier, len(batch))
		for i, key := range batch {
			objects[i] = types.ObjectIdentifier{Key: aws.String(key)}
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return err
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return fmt.Errorf("blobstore: delete %s: %s", aws.ToString(e.Key), aws.ToString(e.Message))
		}
	}
	return nil
}

func (s *S3) List(ctx context.Context, prefix string) ([]Listed, error) {
	var out []Listed
	pages := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket), Prefix: aws.String(prefix)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, obj := range page.Contents {
			out = append(out, Listed{Key: aws.ToString(obj.Key), Modified: aws.ToTime(obj.LastModified)})
		}
	}
	return out, nil
}

func (s *S3) DeletePrefix(ctx context.Context, prefix string) (int, error) {
	var keys []string
	pages := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket), Prefix: aws.String(prefix)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return 0, err
		}
		for _, obj := range page.Contents {
			keys = append(keys, aws.ToString(obj.Key))
		}
	}
	return len(keys), s.Delete(ctx, keys...)
}
