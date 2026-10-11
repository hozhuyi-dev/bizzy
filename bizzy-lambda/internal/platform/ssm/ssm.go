// Package ssm keeps secrets in Parameter Store as SecureStrings.
package ssm

import (
	"context"
	"errors"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	awsssm "github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

// ErrNotFound means the parameter has not been written yet.
var ErrNotFound = errors.New("ssm: parameter not found")

var client = sync.OnceValues(func() (*awsssm.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, err
	}
	return awsssm.NewFromConfig(cfg), nil
})

// SecureString reads and decrypts one SecureString parameter.
func SecureString(ctx context.Context, name string) (string, error) {
	c, err := client()
	if err != nil {
		return "", err
	}

	out, err := c.GetParameter(ctx, &awsssm.GetParameterInput{
		Name:           aws.String(name),
		WithDecryption: aws.Bool(true),
	})
	if notFound(err) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}

	return aws.ToString(out.Parameter.Value), nil
}

// PutSecureString creates or replaces a SecureString parameter, encrypted
// with the account's default aws/ssm key.
func PutSecureString(ctx context.Context, name, value string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.PutParameter(ctx, &awsssm.PutParameterInput{
		Name:      aws.String(name),
		Value:     aws.String(value),
		Type:      types.ParameterTypeSecureString,
		Overwrite: aws.Bool(true),
	})
	return err
}

// Delete removes a parameter; one that is already gone is not an error.
func Delete(ctx context.Context, name string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteParameter(ctx, &awsssm.DeleteParameterInput{Name: aws.String(name)})
	if notFound(err) {
		return nil
	}
	return err
}

func notFound(err error) bool {
	var nf *types.ParameterNotFound
	return errors.As(err, &nf)
}
